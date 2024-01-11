import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as lambdaNodeJs from "aws-cdk-lib/aws-lambda-nodejs";
import * as iam from "aws-cdk-lib/aws-iam";

import * as cdk from "aws-cdk-lib";
import * as ssm from "aws-cdk-lib/aws-ssm";
import * as sqs from "aws-cdk-lib/aws-sqs";
import { Construct } from "constructs";

interface ProductsAppStackProps extends cdk.StackProps {
  eventsDdb: dynamodb.Table;
}

export class ProductsAppStack extends cdk.Stack {
  readonly productsFetchHandler: lambdaNodeJs.NodejsFunction;
  readonly productsAdminHandler: lambdaNodeJs.NodejsFunction;
  readonly productsDdb: dynamodb.Table;

  constructor(scope: Construct, id: string, props: ProductsAppStackProps) {
    super(scope, id, props);
    this.productsDdb = new dynamodb.Table(this, "ProductsDdb", {
      tableName: "products",
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      partitionKey: {
        name: "id",
        type: dynamodb.AttributeType.STRING,
      },
      billingMode: dynamodb.BillingMode.PROVISIONED,
      readCapacity: 1,
      writeCapacity: 1,
    });

    //Products Layer
    const productsLayerArn = ssm.StringParameter.valueForStringParameter(
      this,
      "ProductsLayerVersionArn"
    );
    const productsLayer = lambda.LayerVersion.fromLayerVersionArn(
      this,
      "ProductsLayerVersionArn",
      productsLayerArn
    );

    //Product Events Layer
    const productsEventsLayerArn = ssm.StringParameter.valueForStringParameter(
      this,
      "ProductEventsLayerVersionArn"
    );
    const productEventsLayer = lambda.LayerVersion.fromLayerVersionArn(
      this,
      "ProductEventsLayerVersionArn",
      productsEventsLayerArn
    );

    const productEventsDlq = new sqs.Queue(this, "ProductEventsDlq", {
      queueName: "product-events-dlq",
      retentionPeriod: cdk.Duration.days(10),
      enforceSSL: false,
      encryption: sqs.QueueEncryption.UNENCRYPTED,
    });

    const productEventsHandler = new lambdaNodeJs.NodejsFunction(
      this,
      "ProductEventsFunction",
      {
        functionName: "ProductEventsFunction",
        entry: "lambda/products/productEventsFunction.ts",
        handler: "handler",
        runtime: lambda.Runtime.NODEJS_20_X,
        memorySize: 512,
        timeout: cdk.Duration.seconds(2),
        bundling: {
          minify: true,
          sourceMap: false,
        },
        environment: {
          EVENTS_DDB: props.eventsDdb.tableName,
        },
        layers: [productEventsLayer],
        tracing: lambda.Tracing.ACTIVE,
        insightsVersion: lambda.LambdaInsightsVersion.VERSION_1_0_229_0,
        deadLetterQueueEnabled: true,
        deadLetterQueue: productEventsDlq,
      }
    );
    const eventsDdbPolicy = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ["dynamodb:PutItem"],
      resources: [props.eventsDdb.tableArn],
      conditions: {
        ["ForAllValues:StringLike"]: {
          "dynamodb:LeadingKeys": ["#product_*"],
        },
      },
    });
    productEventsHandler.addToRolePolicy(eventsDdbPolicy);

    this.productsFetchHandler = new lambdaNodeJs.NodejsFunction(
      this,
      "ProductsFetchFunction",
      {
        functionName: "ProductsFetchFunction",
        entry: "lambda/products/productsFetchFunction.ts",
        handler: "handler",
        runtime: lambda.Runtime.NODEJS_20_X,
        memorySize: 512,
        timeout: cdk.Duration.seconds(5),
        bundling: {
          minify: true,
          sourceMap: false,
        },
        environment: {
          PRODUCTS_DDB: this.productsDdb.tableName,
        },
        layers: [productsLayer],
        tracing: lambda.Tracing.ACTIVE,
        insightsVersion: lambda.LambdaInsightsVersion.VERSION_1_0_229_0,
      }
    );
    this.productsDdb.grantReadData(this.productsFetchHandler);

    this.productsAdminHandler = new lambdaNodeJs.NodejsFunction(
      this,
      "ProductsAdminFunction",
      {
        functionName: "ProductsAdminFunction",
        entry: "lambda/products/productsAdminFunction.ts",
        handler: "handler",
        runtime: lambda.Runtime.NODEJS_20_X,
        memorySize: 512,
        timeout: cdk.Duration.seconds(5),
        bundling: {
          minify: true,
          sourceMap: false,
        },
        environment: {
          PRODUCTS_DDB: this.productsDdb.tableName,
          PRODUCT_EVENTS_FUNCTION_NAME: productEventsHandler.functionName,
        },
        layers: [productsLayer, productEventsLayer],
        tracing: lambda.Tracing.ACTIVE,
        insightsVersion: lambda.LambdaInsightsVersion.VERSION_1_0_229_0,
      }
    );
    this.productsDdb.grantWriteData(this.productsAdminHandler);
    productEventsHandler.grantInvoke(this.productsAdminHandler);
  }
}
