import { Schema } from 'mongoose';

// Shared by every append-only collection (auditEvents — Iron Rule 2; signatures — SPEC.md §5.2 /
// Iron Rule 4). Rejects every mutation path at the Mongoose layer itself, not just by convention.
export function applyAppendOnly(schema: Schema, errorMessage: string): void {
  function rejectMutation(next: (err?: Error) => void): void {
    next(new Error(errorMessage));
  }

  schema.pre('updateOne', { document: false, query: true }, function (next) {
    rejectMutation(next);
  });
  schema.pre('updateOne', { document: true, query: false }, function (next) {
    rejectMutation(next);
  });
  schema.pre('updateMany', rejectMutation);
  schema.pre('findOneAndUpdate', rejectMutation);
  schema.pre('deleteOne', { document: false, query: true }, function (next) {
    rejectMutation(next);
  });
  schema.pre('deleteOne', { document: true, query: false }, function (next) {
    rejectMutation(next);
  });
  schema.pre('deleteMany', rejectMutation);
  schema.pre('findOneAndDelete', rejectMutation);
  // pre('save') covers .save() on an already-persisted document; new-document saves (creation)
  // still go through normally.
  schema.pre('save', function (next) {
    if (!this.isNew) {
      rejectMutation(next);
      return;
    }
    next();
  });
}
