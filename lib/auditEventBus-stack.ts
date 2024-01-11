import * as lambda from "aws-cdk-lib/aws-lambda";
import * as lambdaNodeJs from "aws-cdk-lib/aws-lambda-nodejs";
import * as cdk from "aws-cdk-lib";
import * as sqs from "aws-cdk-lib/aws-sqs";
import * as events from "aws-cdk-lib/aws-events";
import * as targets from "aws-cdk-lib/aws-events-targets";
import * as cw from "aws-cdk-lib/aws-cloudwatch";
import { Construct } from "constructs";

// interface AuditEventBusStackProps extends cdk.StackProps {
//   eventsDdb: dynamodb.Table;
// }

export class AuditEventBusStack extends cdk.Stack {
  readonly bus: events.EventBus;
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    this.bus = new events.EventBus(this, "AuditEventBus", {
      eventBusName: "AuditEventBus",
    });

    this.bus.archive("BusArchive", {
      eventPattern: {
        source: ["app.order"],
      },
      archiveName: "auditEvents",
      retention: cdk.Duration.days(10),
    });

    const nonValidOrderRule = new events.Rule(this, "NonValidOrderRule", {
      ruleName: "NonValidOrderRule",
      description: "Rule matching non valid order",
      eventBus: this.bus,
      eventPattern: {
        source: ["app.order"],
        detailType: ["order"],
        detail: {
          reason: ["PRODUCT_NOT_FOUND"],
        },
      },
    });

    const ordersErrorsHandler = new lambdaNodeJs.NodejsFunction(
      this,
      "OrdersErrorsFunction",
      {
        functionName: "OrdersErrorsFunction",
        entry: "lambda/audit/ordersErrorsFunction.ts",
        handler: "handler",
        runtime: lambda.Runtime.NODEJS_20_X,
        memorySize: 512,
        timeout: cdk.Duration.seconds(2),
        bundling: {
          minify: true,
          sourceMap: false,
        },
        tracing: lambda.Tracing.ACTIVE,
      }
    );

    nonValidOrderRule.addTarget(
      new targets.LambdaFunction(ordersErrorsHandler)
    );

    const nonValidInvoiceRule = new events.Rule(this, "NonValidInvoiceRule", {
      ruleName: "NonValidInvoiceRule",
      description: "Rule matching non valid invoice",
      eventBus: this.bus,
      eventPattern: {
        source: ["app.invoice"],
        detailType: ["invoice"],
        detail: {
          errorDetail: ["FAIL_NO_INVOICE_NUMBER"],
        },
      },
    });

    const invoicesErrorsHandler = new lambdaNodeJs.NodejsFunction(
      this,
      "InvoicesErrorsFunction",
      {
        functionName: "InvoicesErrorsFunction",
        entry: "lambda/audit/invoicesErrorsFunction.ts",
        handler: "handler",
        runtime: lambda.Runtime.NODEJS_20_X,
        memorySize: 512,
        timeout: cdk.Duration.seconds(2),
        bundling: {
          minify: true,
          sourceMap: false,
        },
        tracing: lambda.Tracing.ACTIVE,
      }
    );

    nonValidInvoiceRule.addTarget(
      new targets.LambdaFunction(invoicesErrorsHandler)
    );

    const timeoutImportInvoiceRule = new events.Rule(
      this,
      "timeoutImportInvoiceRule",
      {
        ruleName: "timeoutImportInvoiceRule",
        description: "Rule matching timeout import invoice",
        eventBus: this.bus,
        eventPattern: {
          source: ["app.invoice"],
          detailType: ["invoice"],
          detail: {
            errorDetail: ["TIMEOUT"],
          },
        },
      }
    );
    const invoiceImportTimeoutQueue = new sqs.Queue(
      this,
      "InvoiceImportTimeout",
      {
        queueName: "invoice-import-timeout",
      }
    );
    timeoutImportInvoiceRule.addTarget(
      new targets.SqsQueue(invoiceImportTimeoutQueue)
    );

    // Metric
    const numberOfMessagesMetric =
      invoiceImportTimeoutQueue.metricApproximateNumberOfMessagesVisible({
        period: cdk.Duration.minutes(2),
        statistic: "Sum",
      });

    // Alarm
    numberOfMessagesMetric.createAlarm(this, "InvoiceImportTimeoutAlarm", {
      alarmName: "InvoiceImportTimeout",
      actionsEnabled: true,
      evaluationPeriods: 1,
      threshold: 5,
      comparisonOperator:
        cw.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
    });

    const ageOfMessagesMetric =
      invoiceImportTimeoutQueue.metricApproximateAgeOfOldestMessage({
        period: cdk.Duration.minutes(2),
        statistic: "Maximum",
        unit: cw.Unit.SECONDS,
      });

    // Alarm
    ageOfMessagesMetric.createAlarm(this, "AgeOfMessagesInQueueAlarm", {
      alarmName: "AgeOfMessagesInQueue",
      actionsEnabled: false,
      evaluationPeriods: 1,
      threshold: 60,
      comparisonOperator:
        cw.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
    });
  }
}
