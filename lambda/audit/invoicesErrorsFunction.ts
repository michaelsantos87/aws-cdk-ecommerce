import { Context, EventBridgeEvent } from "aws-lambda";
import * as AWSXRay from "aws-xray-sdk";

AWSXRay.captureAWS(require("aws-sdk"));

export async function handler(
  event: EventBridgeEvent<string, string>,
  context: Context
): Promise<void> {
  console.log(event);

  return;
}
