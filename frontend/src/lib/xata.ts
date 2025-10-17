import { buildClient } from '@xata.io/client';

const xata = buildClient({
  apiKey: import.meta.env.VITE_XATA_API_KEY,
  databaseURL: import.meta.env.VITE_XATA_DATABASE_URL,
});

export { xata };
export default xata;
