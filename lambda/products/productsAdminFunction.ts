import {
  APIGatewayProxyEvent,
  APIGatewayProxyResult,
  Context,
} from "aws-lambda";
import { Product, ProductRepository } from "/opt/nodejs/productsLayer";
import { CognitoIdentityServiceProvider, DynamoDB, Lambda } from "aws-sdk";
import { ProductEvent, ProductEventType } from "/opt/nodejs/productEventsLayer";
import * as AWSXRay from "aws-xray-sdk";
import { AuthInfoService } from "opt/nodejs/authUserInfo";

AWSXRay.captureAWS(require("aws-sdk"));

const productsDdb = process.env.PRODUCTS_DDB!;
const ddbClient = new DynamoDB.DocumentClient();
const productEventsFunctionName = process.env.PRODUCT_EVENTS_FUNCTION_NAME!;
const lambdaClient = new Lambda();
const cognitoIdentityServiceProvider = new CognitoIdentityServiceProvider();

const productRepository = new ProductRepository(ddbClient, productsDdb);
const authInfoService = new AuthInfoService(cognitoIdentityServiceProvider);

export async function handler(
  event: APIGatewayProxyEvent,
  context: Context
): Promise<APIGatewayProxyResult> {
  const lambdaRequestId = context.awsRequestId;
  const apiRequestId = event.requestContext.requestId;

  console.log(
    `API Gateway RequestId: ${apiRequestId} - Lambda RequestId: ${lambdaRequestId}`
  );

  const userEmail = await authInfoService.getUserInfo(
    event.requestContext.authorizer
  );

  const method = event.httpMethod;
  if (event.resource === "/products") {
    if (method === "POST") {
      console.log("POST /products");
      const product = JSON.parse(event.body!) as Product;
      const productCreated = await productRepository.create(product);

      const response = await sendProductEvent(
        productCreated,
        ProductEventType.CREATED,
        userEmail,
        lambdaRequestId
      );
      console.log(response);

      return {
        statusCode: 201,
        body: JSON.stringify(productCreated),
      };
    }
  } else if (event.resource === "/products/{id}") {
    const productId = event.pathParameters!.id as string;

    if (method === "PUT") {
      console.log(`PUT /products/${productId}`);

      try {
        const product = JSON.parse(event.body!) as Product;
        const productUpdated = await productRepository.updateProduct(
          productId,
          product
        );
        const response = await sendProductEvent(
          productUpdated,
          ProductEventType.UPDATED,
          userEmail,
          lambdaRequestId
        );
        console.log(response);

        return {
          statusCode: 200,
          body: JSON.stringify(productUpdated),
        };
      } catch (ConditionalCheckFailedException) {
        return {
          statusCode: 404,
          body: "Product not found",
        };
      }
    } else if (method === "DELETE") {
      console.log(`DELETE /products/${productId}`);

      try {
        const product = await productRepository.deleteProduct(productId);
        const response = await sendProductEvent(
          product,
          ProductEventType.DELETED,
          userEmail,
          lambdaRequestId
        );
        console.log(response);

        return {
          statusCode: 200,
          body: JSON.stringify(product),
        };
      } catch (error) {
        return {
          statusCode: 404,
          body: (<Error>error).message,
        };
      }
    }
  }

  return {
    statusCode: 404,
    body: "Internal Error",
  };
}

function sendProductEvent(
  product: Product,
  eventType: ProductEventType,
  email: string,
  lambdaRequestId: string
) {
  const event: ProductEvent = {
    email: email,
    eventType: eventType,
    productCode: product.code,
    productId: product.id,
    productPrice: product.price,
    requestId: lambdaRequestId,
  };

  return lambdaClient
    .invoke({
      FunctionName: productEventsFunctionName,
      Payload: JSON.stringify(event),
      InvocationType: "Event",
    })
    .promise();
}
