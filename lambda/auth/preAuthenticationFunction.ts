import {
  Callback,
  Context,
  EventBridgeEvent,
  PreAuthenticationTriggerEvent,
} from "aws-lambda";
// import * as AWSXRay from "aws-xray-sdk";
// AWSXRay.captureAWS(require("aws-sdk"));

export async function handler(
  event: PreAuthenticationTriggerEvent,
  context: Context,
  callback: Callback
): Promise<void> {
  console.log(event);

  if (event.request.userAttributes.email === "michaelsantos.123@gmail.com") {
    callback("This user is blocked. Reason: PAYMENT", event);
  } else {
    callback(null, event);
  }
}
