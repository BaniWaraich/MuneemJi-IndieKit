import { drizzle } from "drizzle-orm/postgres-js";
import * as userSchema from "./schema/user";
import * as plansSchema from "./schema/plans";
import * as creditsSchema from "./schema/credits";
import * as couponsSchema from "./schema/coupons";
import * as contactSchema from "./schema/contact";
import * as waitlistSchema from "./schema/waitlist";
import * as paypalSchema from "./schema/paypal";
import * as muneemSchema from "./schema/muneem";

const schema = {
  ...userSchema,
  ...plansSchema,
  ...creditsSchema,
  ...couponsSchema,
  ...contactSchema,
  ...waitlistSchema,
  ...paypalSchema,
  ...muneemSchema,
};

export const db = drizzle(process.env.DATABASE_URL!, { schema });
