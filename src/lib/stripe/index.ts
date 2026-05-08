import stripeClient from "stripe";

let _stripe: stripeClient | undefined;

const stripe = new Proxy({} as stripeClient, {
  get(_, prop: string | symbol) {
    if (!_stripe) {
      _stripe = new stripeClient(process.env.STRIPE_SECRET_KEY!);
    }
    return (_stripe as any)[prop];
  },
});

export default stripe;
