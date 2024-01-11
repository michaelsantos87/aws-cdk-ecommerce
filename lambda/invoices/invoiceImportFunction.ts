import { Context, S3Event, S3EventRecord } from "aws-lambda";
import * as AWSXRay from "aws-xray-sdk";
import { ApiGatewayManagementApi, DynamoDB, S3 } from "aws-sdk";
import {
  InvoiceTransactionStatus,
  InvoiceTransactionRepository,
} from "opt/nodejs/invoiceTransaction";
import { InvoiceWSService } from "opt/nodejs/invoiceWSConnection";
import { InvoiceFile, InvoiceRepository } from "opt/nodejs/invoiceRepository";

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

  await Promise.all(promises);
  return;
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

      const object = await s3Client
        .getObject({
          Key: key,
          Bucket: record.s3.bucket.name,
        })
        .promise();

      const invoice = JSON.parse(object.Body!.toString("utf-8")) as InvoiceFile;
      console.log(invoice);

      if (invoice.invoiceNumber.length && invoice.invoiceNumber.length >= 5) {
        const createInvoicePromise = invoiceRepository.create({
          pk: `#invoice_${invoice.customerName}`,
          sk: invoice.invoiceNumber,
          ttl: 0,
          totalValue: invoice.totalValue,
          productId: invoice.productId,
          quantity: invoice.quantity,
          transactionId: key,
          createdAt: Date.now(),
        });

        const deleteObjectPromise = s3Client
          .deleteObject({
            Key: key,
            Bucket: record.s3.bucket.name,
          })
          .promise();

        const updateInvoicePromise =
          invoiceTransactionRepository.updateInvoiceTransaction(
            key,
            InvoiceTransactionStatus.PROCESSED
          );
        const sendStatusPromise = invoiceWSService.sendInvoiceStatus(
          key,
          invoiceTransaction.connectionId,
          InvoiceTransactionStatus.PROCESSED
        );

        await Promise.all([
          createInvoicePromise,
          deleteObjectPromise,
          updateInvoicePromise,
          sendStatusPromise,
        ]);
      } else {
        console.log(
          `Invoice import failed - non valid invoice number - TransactionId: ${key}`
        );

        const updateInvoicePromise =
          invoiceTransactionRepository.updateInvoiceTransaction(
            key,
            InvoiceTransactionStatus.NON_VALID_INVOICE_NUMBER
          );
        const sendStatusPromise = invoiceWSService.sendInvoiceStatus(
          key,
          invoiceTransaction.connectionId,
          InvoiceTransactionStatus.NON_VALID_INVOICE_NUMBER
        );

        await Promise.all([updateInvoicePromise, sendStatusPromise]);

        await invoiceWSService.disconnectClient(key);
      }
    } else {
      await invoiceWSService.sendInvoiceStatus(
        key,
        invoiceTransaction.connectionId,
        invoiceTransaction.transactionStatus
      );
      console.error("Not valid transaction status");
      return;
    }
  } catch (error) {
    console.log((<Error>error).message);
  }
}
