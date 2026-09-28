import type { Rfq } from "../shared/rfq.js";
import type { RfqRow } from "./db.js";

export function serializeRfq(row: RfqRow): Rfq {
  return {
    id: row.id,
    archiveDate: row.archive_date,
    solicitationNumber: row.solicitation_number,
    title: row.title,
    nsn: row.nsn,
    purchaseRequest: row.purchase_request,
    quantity: row.quantity,
    unit: row.unit,
    issuedDate: row.issued_date,
    closeDate: row.close_date,
    buyerName: row.buyer_name,
    buyerCode: row.buyer_code,
    buyerEmail: row.buyer_email,
    agency: row.agency,
    supplyChain: row.supply_chain,
    naics: row.naics,
    deliveryDays: row.delivery_days,
    estimatedUnitPrice: row.estimated_unit_price,
    estimatedValue: row.estimated_value,
    filename: row.filename,
    fileSize: row.file_size,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
