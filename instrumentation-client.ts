import { initBotId } from "botid/client/core";

initBotId({ protect: [{ path: "/api/checkout/subscription-v2", method: "POST" }] });
