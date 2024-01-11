import {
  APIGatewayProxyEvent,
  APIGatewayProxyResult,
  Context,
} from "aws-lambda";
import * as AWSXRay from "aws-xray-sdk";
// import { DynamoDB } from "aws-sdk";

AWSXRay.captureAWS(require("aws-sdk"));

// const eventsDdb = process.env.EVENTS_DDB!;
// const ddbClient = new DynamoDB.DocumentClient();
// const orderEventsRepository = new OrderEventRepository(ddbClient, eventsDdb);

export async function handler(
  event: APIGatewayProxyEvent,
  context: Context
): Promise<APIGatewayProxyResult> {
  console.log(event);

  // const apiRequestId = event.requestContext.requestId;
  // const lambdaRequestId = context.awsRequestId;

  // const email = event.queryStringParameters!.email!;
  // const eventType = event.queryStringParameters!.eventType;

  // console.log(
  //   `API Gateway RequestId: ${apiRequestId} - Lambda RequestId: ${lambdaRequestId}`
  // );

  // if (eventType) {
  //   const orderEvents =
  //     await orderEventsRepository.getOrderEventsByEmailAndEventType(
  //       email,
  //       eventType
  //     );

  //   return {
  //     statusCode: 200,
  //     body: JSON.stringify({
  //       message: JSON.stringify(convertOrderEvents(orderEvents)),
  //     }),
  //   };
  // } else {
  //   const orderEvents = await orderEventsRepository.getOrderEventsByEmail(
  //     email
  //   );

  //   return {
  //     statusCode: 200,
  //     body: JSON.stringify({
  //       message: JSON.stringify(convertOrderEvents(orderEvents)),
  //     }),
  //   };
  // }

  return {
    statusCode: 200,
    body: JSON.stringify("ok"),
  };
}
