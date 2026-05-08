import DodoPayments from "dodopayments";

let _client: DodoPayments | undefined;

const client = new Proxy({} as DodoPayments, {
  get(_, prop: string | symbol) {
    if (!_client) {
      _client = new DodoPayments({
        baseURL: process.env.DODO_PAYMENTS_API_URL,
        bearerToken: process.env.DODO_PAYMENTS_API_KEY,
      });
    }
    return (_client as any)[prop];
  },
});

export default client;
