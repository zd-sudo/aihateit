import { handleHit, openHitStore } from "../../lib/hits.mjs";

export default async (request) => {
  const store = await openHitStore();
  return handleHit(request, store);
};
