import { DocumentClient } from "aws-sdk/clients/dynamodb";
import { v4 as uuid } from "uuid";

export enum ProductEventType {
  CREATED = "PRODUCT_CREATED",
  UPDATED = "PRODUCT_UPDATED",
  DELETED = "PRODUCT_DELETED",
}

export interface ProductEvent {
  requestId: string;
  eventType: ProductEventType;
  productId: string;
  productCode: string;
  productPrice: number;
  email: string;
}
