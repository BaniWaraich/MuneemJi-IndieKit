import { AppConfigPublic } from "./types";

export const appConfig: AppConfigPublic = {
  projectName: "Muneem Ji",
  projectSlug: "muneem-ji",
  keywords: [
    "Muneem Ji",
    "NextJS Boilerplate",
    "NextJS SaaS",
    "NextJS Starter Kit",
    "SaaS Boilerplate",
    "SaaS Starter Kit",
    "Muneem Ji Pro",
  ],
  description:
    "Muneem Ji is a NextJS starter kit for building your own SaaS in hours.",
  auth: {
    enablePasswordAuth: true,
  },
  legal: {
    address: {
      street: "Plot No 337, Workyard, Phase 2, Industrial Business &amp; Park",
      city: "Chandigarh",
      state: "Punjab",
      postalCode: "160002",
      country: "India",
    },
    email: "ssent.hq@gmail.com",
    phone: "+91 9876543210",
  },
  social: {
    twitter: "https://twitter.com/cjsingg",
    instagram: "https://instagram.com/-",
    linkedin: "https://linkedin.com/-",
    facebook: "https://facebook.com/-",
    youtube: "https://youtube.com/-",
  },
  email: {
    senderName: "Indie Kit",
    senderEmail: "ssent.hq@gmail.com",
  },
};
