import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ordersPath = path.join(__dirname, "..", "data", "orders.json");
const orders = JSON.parse(readFileSync(ordersPath, "utf-8"));

export const orderStatusTool = {
  definition: {
    type: "function",
    function: {
      name: "get_order_status",
      description:
        "Look up the shipping status of a customer order by order ID. " +
        "Order IDs look like 'ORD-1001'. Returns status, carrier, tracking number, and estimated delivery date.",
      parameters: {
        type: "object",
        properties: {
          orderId: {
            type: "string",
            description: "The order ID, e.g. 'ORD-1001'"
          }
        },
        required: ["orderId"]
      }
    }
  },

  async handler({ orderId }) {
    const order = orders[orderId];

    if (!order) {
      throw new Error(`No order found with ID '${orderId}'`);
    }

    // Simulates a downstream dependency (warehouse system, carrier API) being
    // unavailable, so the agent loop's retry/error-handling path has something
    // real to exercise in tests instead of only ever seeing the happy path.
    if (order.status === "simulate-outage") {
      throw new Error("Order lookup service timed out");
    }

    return JSON.stringify({
      orderId,
      status: order.status,
      carrier: order.carrier,
      trackingNumber: order.trackingNumber,
      estimatedDelivery: order.estimatedDelivery
    });
  }
};
