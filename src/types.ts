export interface SplitwiseUser {
  id: number;
  first_name: string;
  last_name: string;
  email: string;
  picture: {
    small: string;
    medium: string;
    large: string;
  };
}

export interface SplitwiseGroup {
  id: number;
  name: string;
  updated_at: string;
  members: SplitwiseUser[];
}

export interface ReceiptData {
  merchant: string;
  date: string;
  total: number;
  currency: string;
  items: {
    name: string;
    price: number;
    description?: string;
  }[];
}

export type SplitType = "equal" | "exact" | "percent";
