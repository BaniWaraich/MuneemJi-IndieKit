import NextAuth from "next-auth";
import GoogleProvider from "next-auth/providers/google";
import { type EmailConfig } from "next-auth/providers/email";
import CredentialsProvider from "next-auth/providers/credentials";
import { db } from "./db";
import { DrizzleAdapter } from "@auth/drizzle-adapter";
import {
  accounts,
  sessions,
  users,
  verificationTokens,
} from "./db/schema/user";
import onUserCreate from "./lib/users/onUserCreate";
import { render } from "@react-email/components";
import MagicLinkEmail from "./emails/MagicLinkEmail";
import sendMail from "./lib/email/sendMail";
import { appConfig } from "./lib/config";
import { decryptJson } from "./lib/encryption/edge-jwt";
import { eq } from "drizzle-orm";

// Overrides default session type
declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      email: string;
      impersonatedBy?: string;
      // Muneem Ji: CA staff and BO users carry role + firmId
      role?: "ca_admin" | "ca_staff" | "business_owner";
      firmId?: string;
    };
    expires: string;
  }
}

interface ImpersonateToken {
  impersonateIntoId: string;
  impersonateIntoEmail: string;
  impersonator: string;
  expiry: string;
}

const emailProvider: EmailConfig = {
  id: "email",
  type: "email",
  name: "Email",
  async sendVerificationRequest(params) {
    if (process.env.NODE_ENV === "development") {
      console.log(
        `Magic link for ${params.identifier}: ${params.url} expires at ${params.expires}`
      );
    }
    const html = await render(
      MagicLinkEmail({ url: params.url, expiresAt: params.expires })
    );

    await sendMail(
      params.identifier,
      `Sign in to ${appConfig.projectName}`,
      html
    );
  },
};

const adapter = DrizzleAdapter(db, {
  usersTable: users,
  accountsTable: accounts,
  sessionsTable: sessions,
  verificationTokensTable: verificationTokens,
});

export const { handlers, signIn, signOut, auth } = NextAuth({
  pages: {
    signIn: "/login",
    signOut: "/sign-out",
  },
  session: {
    strategy: "jwt",
  },
  adapter: {
    ...adapter,
    createUser: async (user) => {
      if (!adapter.createUser) {
        throw new Error("Adapter is not initialized");
      }
      const newUser = await adapter.createUser(user);
      // Update the user with the default plan
      await onUserCreate(newUser);

      return newUser;
    },
  },
  callbacks: {
    async signIn() {
      return process.env.NEXT_PUBLIC_SIGNIN_ENABLED === "true";
    },
    async session({ session, token }) {
      if (token.sub) {
        session.user.id = token.sub;
      }
      if (token.email) {
        session.user.email = token.email;
      }
      if (token.impersonatedBy) {
        session.user.impersonatedBy = token.impersonatedBy as string;
      }
      // Muneem Ji: expose role + firmId on session for CA staff
      if (token.role) {
        session.user.role = token.role as "ca_admin" | "ca_staff" | "business_owner";
      }
      if (token.firmId) {
        session.user.firmId = token.firmId as string;
      }
      return session;
    },
    async jwt({ token, user }) {
      // If user object is available (after sign in), check if impersonation is happening
      if (user && "impersonatedBy" in user) {
        token.impersonatedBy = user.impersonatedBy;
      }

      // Muneem Ji: load role + firmId from app_user on first sign-in
      if (user?.id) {
        const dbUser = await db
          .select({ role: users.role, firmId: users.firmId })
          .from(users)
          .where(eq(users.id, user.id))
          .limit(1)
          .then((rows) => rows[0]);
        if (dbUser?.role) token.role = dbUser.role;
        if (dbUser?.firmId) token.firmId = dbUser.firmId;
      }

      // NOTE: Keep the token minimal to avoid stale data problems.
      return {
        sub: token.sub,
        email: token.email,
        impersonatedBy: token.impersonatedBy,
        role: token.role,
        firmId: token.firmId,
        iat: token.iat,
        exp: token.exp,
        jti: token.jti,
      };
    },
  },
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      allowDangerousEmailAccountLinking: true,
    }),
    emailProvider,
    // Password-based authentication
    ...(appConfig.auth?.enablePasswordAuth
      ? [
          CredentialsProvider({
            id: "credentials",
            name: "Credentials",
            credentials: {
              email: {
                label: "Email",
                type: "email",
                placeholder: "name@example.com",
              },
              password: {
                label: "Password",
                type: "password",
              },
            },
            async authorize(credentials) {
              if (!credentials?.email || !credentials?.password) {
                return null;
              }

              try {
                // Find user by email
                const user = await db
                  .select({
                    id: users.id,
                    email: users.email,
                    name: users.name,
                    password: users.password,
                  })
                  .from(users)
                  .where(eq(users.email, credentials.email as string))
                  .limit(1)
                  .then((users) => users[0]);

                if (!user || !user.password) {
                  return null;
                }

                const { verifyPassword } = await import("./lib/auth/password");
                // Verify password
                const passwordCorrect = await verifyPassword(
                  credentials.password as string,
                  user.password
                );

                if (!passwordCorrect) {
                  return null;
                }

                return {
                  id: user.id,
                  email: user.email,
                  name: user.name,
                };
              } catch (error) {
                console.error("Error during password authentication:", error);
                return null;
              }
            },
          }),
        ]
      : []),
    // Impersonation provider (super admin only)
    CredentialsProvider({
      id: "impersonation",
      name: "Impersonation",
      credentials: {
        signedToken: {
          label: "Signed Token",
          type: "text",
          placeholder: "Signed Token",
          required: true,
        },
      },
      async authorize(credentials) {
        if (!credentials?.signedToken) {
          return null;
        }

        try {
          // The token is already URL encoded, decryptJson handles the decoding
          const impersonationToken = await decryptJson<ImpersonateToken>(
            credentials.signedToken as string
          );

          // Validate token expiry
          if (new Date(impersonationToken.expiry) < new Date()) {
            throw new Error("Impersonation token expired");
          }

          // Trust the decrypted token without additional database validations
          return {
            id: impersonationToken.impersonateIntoId,
            email: impersonationToken.impersonateIntoEmail,
            impersonatedBy: impersonationToken.impersonator,
          };
        } catch (error) {
          console.error("Error during impersonation:", error);
          return null;
        }
      },
    }),
    // Muneem Ji: Business Owner (BO) login via client_users table
    CredentialsProvider({
      id: "client-credentials",
      name: "Client Credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null;
        try {
          const { clientUsers } = await import("./db/schema/muneem");
          const { verifyPassword } = await import("./lib/auth/password");
          const row = await db
            .select({
              id: clientUsers.id,
              email: clientUsers.email,
              name: clientUsers.name,
              passwordHash: clientUsers.passwordHash,
              clientOrgId: clientUsers.clientOrgId,
            })
            .from(clientUsers)
            .where(eq(clientUsers.email, credentials.email as string))
            .limit(1)
            .then((rows) => rows[0]);
          if (!row) return null;
          const ok = await verifyPassword(credentials.password as string, row.passwordHash);
          if (!ok) return null;
          return {
            id: row.id,
            email: row.email,
            name: row.name,
            role: "business_owner" as const,
            firmId: row.clientOrgId, // BO's firm context = their clientOrgId
          };
        } catch (err) {
          console.error("Error during BO authentication:", err);
          return null;
        }
      },
    }),
    // TIP: Add more providers here as needed like Apple, Facebook, etc.
  ],
});
