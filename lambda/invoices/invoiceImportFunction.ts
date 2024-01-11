import { Context, S3Event, S3EventRecord } from "aws-lambda";
import * as AWSXRay from "aws-xray-sdk";
import { ApiGatewayManagementApi, DynamoDB, S3 } from "aws-sdk";
import { v4 as uuid } from "uuid";
import {
  InvoiceTransactionStatus,
  InvoiceTransactionRepository,
} from "opt/nodejs/invoiceTransaction";
import { InvoiceWSService } from "opt/nodejs/invoiceWSConnection";
import { InvoiceRepository } from "opt/nodejs/invoiceRepository";

AWSXRay.captureAWS(require("aws-sdk"));

const invoicesDdb = process.env.INVOICE_DDB!;
const invoicesWsApiEndPoint = process.env.INVOICE_WSAPI_ENDPOINT!.substring(6);

const s3Client = new S3();
const ddbClient = new DynamoDB.DocumentClient();
const apigwManagementApi = new ApiGatewayManagementApi({
  endpoint: invoicesWsApiEndPoint,
});

const invoiceTransactionRepository = new InvoiceTransactionRepository(
  ddbClient,
  invoicesDdb
);
const invoiceWSService = new InvoiceWSService(apigwManagementApi);
const invoiceRepository = new InvoiceRepository(ddbClient, invoicesDdb);

export async function handler(event: S3Event, context: Context): Promise<void> {
  // TODO - to be removed
  console.log(event);

  const promises: Promise<void>[] = [];
  event.Records.forEach((record) => {
    promises.push(processRecord(record));
  });

  return;
  // const lambdaRequestId = context.awsRequestId;
  // const connectionId = event.requestContext.connectionId!;

  // console.log(
  //   `ConnectionId: ${connectionId} - Lambda RequestId: ${lambdaRequestId}`
  // );

  // const key = uuid();
  // const expires = 300;

  // const signedUrlPut = await s3Client.getSignedUrlPromise("putObject", {
  //   Bucket: bucketName,
  //   Key: key,
  //   Expires: expires,
  // });

  // // Create invoice transaction
  // const timestamp = Date.now();
  // const ttl = ~~(timestamp / 1000 + 60 * 2);

  // await invoiceTransactionRepository.createInvoiceTransaction({
  //   pk: "#transaction",
  //   sk: key,
  //   ttl: ttl,
  //   requestId: lambdaRequestId,
  //   transactionStatus: InvoiceTransactionStatus.GENERATED,
  //   timestamp: timestamp,
  //   expiresIn: expires,
  //   connectionId: connectionId,
  //   endpoint: invoicesWsApiEndPoint,
  // });

  // // Send URL back to WS connected client
  // const postData = JSON.stringify({
  //   url: signedUrlPut,
  //   expires: expires,
  //   transactionId: key,
  // });

  // await invoiceWSService.sendData(connectionId, postData);

  // return {
  //   statusCode: 200,
  //   body: "Ok",
  // };
}

async function processRecord(record: S3EventRecord) {
  const key = record.s3.object.key;
  try {
    const invoiceTransaction =
      await invoiceTransactionRepository.getInvoiceTransaction(key);

    if (
      invoiceTransaction.transactionStatus ===
      InvoiceTransactionStatus.GENERATED
    ) {
      await Promise.all([
        invoiceWSService.sendInvoiceStatus(
          key,
          invoiceTransaction.connectionId,
          InvoiceTransactionStatus.RECEIVED
        ),
        invoiceTransactionRepository.updateInvoiceTransaction(
          key,
          InvoiceTransactionStatus.RECEIVED
        ),
      ]);
    } else {
      await invoiceWSService.sendInvoiceStatus(
        key,
        invoiceTransaction.connectionId,
        invoiceTransaction.transactionStatus
      );
      console.error("Nov valid transaction status");
      return;
    }
  } catch (error) {
    console.log((<Error>error).message);
  }
}
