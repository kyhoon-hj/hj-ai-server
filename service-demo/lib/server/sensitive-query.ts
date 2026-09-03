const EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;
const KOREAN_MOBILE = /(?:^|\D)01[016789][- .]?\d{3,4}[- .]?\d{4}(?:\D|$)/;
const RESIDENT_NUMBER = /(?:^|\D)\d{6}[- ]?[1-4]\d{6}(?:\D|$)/;
const ORDER_NUMBER = /(?:주문\s*(?:번호)?|order\s*(?:no\.?|number)?)[\s:#-]*[A-Z0-9][A-Z0-9-]{5,}/i;

export function containsSensitiveCustomerData(query: string): boolean {
  return EMAIL.test(query) || KOREAN_MOBILE.test(query) || RESIDENT_NUMBER.test(query) || ORDER_NUMBER.test(query);
}
