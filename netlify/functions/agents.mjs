import { handleRegister } from "../../lib/agents.mjs";
import { openStore } from "../../lib/store.mjs";

export default async (request) => {
  const store = await openStore();
  return handleRegister(request, store);
};
