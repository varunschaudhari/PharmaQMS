// QRX-2 (SPEC.md §7.4, Non-Goals §3): material status verification ONLY — no quantities, no
// stock movement, no consumption, no warehouse logic. This enum exists purely to answer "can this
// material be used?" via a QR scan; it is not an inventory model.
export enum MaterialLotStatus {
  QUARANTINE = 'quarantine',
  UNDER_TEST = 'under_test',
  APPROVED = 'approved',
  REJECTED = 'rejected',
}
