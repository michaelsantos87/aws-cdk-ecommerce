import { Callback, Context, PostConfirmationTriggerEvent } from "aws-lambda";
// import * as AWSXRay from "aws-xray-sdk";
// AWSXRay.captureAWS(require("aws-sdk"));

export async function handler(
  event: PostConfirmationTriggerEvent,
  context: Context,
  callback: Callback
): Promise<void> {
  console.log(event);

  callback(null, event);
}
