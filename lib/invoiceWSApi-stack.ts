import * as cdk from "aws-cdk-lib";
import * as apigatewayv2 from "@aws-cdk/aws-apigatewayv2-alpha";
import * as apigatewayv2_integrations from "@aws-cdk/aws-apigatewayv2-integrations-alpha";
import * as lambdaNodeJs from "aws-cdk-lib/aws-lambda-nodejs";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as iam from "aws-cdk-lib/aws-iam";
import * as s3n from "aws-cdk-lib/aws-s3-notifications";
import * as ssm from "aws-cdk-lib/aws-ssm";
import * as lambda from "aws-cdk-lib/aws-lambda";
import { Construct } from "constructs";

// interface InvoiceWSApiStackProps extends cdk.StackProps {
//   productsFetchHandler: lambdaNodeJs.NodejsFunction;
//   productsAdminHandler: lambdaNodeJs.NodejsFunction;
//   ordersHandler: lambdaNodeJs.NodejsFunction;
//   orderEventsFetchHandler: lambdaNodeJs.NodejsFunction;
// }

export class InvoiceWSApiStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: cdk.StackProps) {
    super(scope, id, props);

    // Invoice Transaction Layer
    const invoiceTransactionLayerArn =
      ssm.StringParameter.valueForStringParameter(
        this,
        "InvoiceTransactionLayerVersionArn"
      );
    const invoiceTransactionLayer = lambda.LayerVersion.fromLayerVersionArn(
      this,
      "InvoiceTransactionLayer",
      invoiceTransactionLayerArn
    );

    // Invoice Layer
    const invoiceLayerArn = ssm.StringParameter.valueForStringParameter(
      this,
      "InvoiceRepositoryLayerVersionArn"
    );
    const invoiceLayer = lambda.LayerVersion.fromLayerVersionArn(
      this,
      "InvoiceRepositoryLayer",
      invoiceLayerArn
    );

    // Invoice WebSocket API Layer
    const invoiceWSConnectionLayerArn =
      ssm.StringParameter.valueForStringParameter(
        this,
        "InvoiceWSConnectionLayerVersionArn"
      );
    const invoiceWSConnectionLayer = lambda.LayerVersion.fromLayerVersionArn(
      this,
      "InvoiceWSConnectionLayer",
      invoiceWSConnectionLayerArn
    );

    // Invoice and invoice transaction DDB
    const invoicesDdb = new dynamodb.Table(this, "InvoicesDdb", {
      tableName: "invoices",
      billingMode: dynamodb.BillingMode.PROVISIONED,
      readCapacity: 1,
      writeCapacity: 1,
      partitionKey: {
        name: "pk",
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: "sk",
        type: dynamodb.AttributeType.STRING,
      },
      timeToLiveAttribute: "ttl",
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // Invoice bucket
    const bucket = new s3.Bucket(this, "InvoiceBucket", {
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      lifecycleRules: [
        {
          enabled: true,
          expiration: cdk.Duration.days(1),
        },
      ],
    });

    // WebSocket connection handler
    const connectionHandler = new lambdaNodeJs.NodejsFunction(
      this,
      "InvoiceConnectionFunction",
      {
        functionName: "InvoiceConnectionFunction",
        entry: "lambda/invoices/invoiceConnectionFunction.ts",
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

    // WebSocket disconnection handler
    const disconnectionHandler = new lambdaNodeJs.NodejsFunction(
      this,
      "InvoiceDisconnectionFunction",
      {
        functionName: "InvoiceDisconnectionFunction",
        entry: "lambda/invoices/invoiceDisconnectionFunction.ts",
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

    // WebSocket API
    const webSocketApi = new apigatewayv2.WebSocketApi(this, "InvoiceWSApi", {
      apiName: "InvoiceWSApi",
      connectRouteOptions: {
        integration: new apigatewayv2_integrations.WebSocketLambdaIntegration(
          "ConnectionHandler",
          connectionHandler
        ),
      },
      disconnectRouteOptions: {
        integration: new apigatewayv2_integrations.WebSocketLambdaIntegration(
          "DisconnectionHandler",
          disconnectionHandler
        ),
      },
    });

    const stage = "prod";
    const wsApiEndpoint = `${webSocketApi.apiEndpoint}/${stage}`;
    new apigatewayv2.WebSocketStage(this, "InvoiceWSApiStage", {
      webSocketApi: webSocketApi,
      stageName: stage,
      autoDeploy: true,
    });

    // Invoice URL handler
    const getUrlHandler = new lambdaNodeJs.NodejsFunction(
      this,
      "InvoiceGetUrlFunction",
      {
        functionName: "InvoiceGetUrlFunction",
        entry: "lambda/invoices/invoiceGetUrlFunction.ts",
        handler: "handler",
        runtime: lambda.Runtime.NODEJS_20_X,
        memorySize: 512,
        timeout: cdk.Duration.seconds(2),
        bundling: {
          minify: true,
          sourceMap: false,
        },
        layers: [invoiceTransactionLayer, invoiceWSConnectionLayer],
        tracing: lambda.Tracing.ACTIVE,
        environment: {
          INVOICE_DDB: invoicesDdb.tableName,
          BUCKET_NAME: bucket.bucketName,
          INVOICE_WSAPI_ENDPOINT: wsApiEndpoint,
        },
      }
    );

    const invoicesDbdWriteTransactionPolicy = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ["dynamodb:PutItem"],
      resources: [invoicesDdb.tableArn],
      conditions: {
        ["ForAllValues:StringLike"]: {
          "dynamodb:LeadingKeys": ["#transaction"],
        },
      },
    });
    const invoicesBucketPutObjectPolicy = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ["s3:PutObject"],
      resources: [`${bucket.bucketArn}/*`],
    });

    getUrlHandler.addToRolePolicy(invoicesDbdWriteTransactionPolicy);
    getUrlHandler.addToRolePolicy(invoicesBucketPutObjectPolicy);
    webSocketApi.grantManageConnections(getUrlHandler);

    // Invoice import handler
    const invoiceImportHandler = new lambdaNodeJs.NodejsFunction(
      this,
      "InvoiceImportFunction",
      {
        functionName: "InvoiceImportFunction",
        entry: "lambda/invoices/invoiceImportFunction.ts",
        handler: "handler",
        runtime: lambda.Runtime.NODEJS_20_X,
        memorySize: 512,
        timeout: cdk.Duration.seconds(2),
        bundling: {
          minify: true,
          sourceMap: false,
        },
        layers: [
          invoiceLayer,
          invoiceTransactionLayer,
          invoiceWSConnectionLayer,
        ],
        tracing: lambda.Tracing.ACTIVE,
        environment: {
          INVOICE_DDB: invoicesDdb.tableName,
          INVOICE_WSAPI_ENDPOINT: wsApiEndpoint,
        },
      }
    );
    invoicesDdb.grantReadWriteData(invoiceImportHandler);

    bucket.addEventNotification(
      s3.EventType.OBJECT_CREATED_PUT,
      new s3n.LambdaDestination(invoiceImportHandler)
    );

    const invoicesBucketGetDeleteObjectPolicy = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ["s3:DeleteObject", "s3:GetObject"],
      resources: [`${bucket.bucketArn}/*`],
    });
    invoiceImportHandler.addToRolePolicy(invoicesBucketGetDeleteObjectPolicy);
    webSocketApi.grantManageConnections(invoiceImportHandler);

    // Cancel import handler
    const cancelImportHandler = new lambdaNodeJs.NodejsFunction(
      this,
      "CancelImportFunction",
      {
        functionName: "CancelImportFunction",
        entry: "lambda/invoices/cancelImportFunction.ts",
        handler: "handler",
        runtime: lambda.Runtime.NODEJS_20_X,
        memorySize: 512,
        timeout: cdk.Duration.seconds(2),
        bundling: {
          minify: true,
          sourceMap: false,
        },
        layers: [invoiceTransactionLayer, invoiceWSConnectionLayer],
        tracing: lambda.Tracing.ACTIVE,
        environment: {
          INVOICE_DDB: invoicesDdb.tableName,
          INVOICE_WSAPI_ENDPOINT: wsApiEndpoint,
        },
      }
    );

    const invoicesDbdReadWriteTransactionPolicy = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ["dynamodb:UpdateItem", "dynamodb:GetItem"],
      resources: [invoicesDdb.tableArn],
      conditions: {
        ["ForAllValues:StringLike"]: {
          "dynamodb:LeadingKeys": ["#transaction"],
        },
      },
    });
    cancelImportHandler.addToRolePolicy(invoicesDbdReadWriteTransactionPolicy);
    webSocketApi.grantManageConnections(cancelImportHandler);

    // WebSocket API routes
    webSocketApi.addRoute("getImportUrl", {
      integration: new apigatewayv2_integrations.WebSocketLambdaIntegration(
        "GetUrlHandler",
        getUrlHandler
      ),
    });

    webSocketApi.addRoute("cancelImport", {
      integration: new apigatewayv2_integrations.WebSocketLambdaIntegration(
        "CancelImportHandler",
        cancelImportHandler
      ),
    });
  }
}
