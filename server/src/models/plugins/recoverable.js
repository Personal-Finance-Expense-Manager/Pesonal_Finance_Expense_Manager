/** Normal queries hide tombstones; recovery explicitly opts in. No TTL: parents
 * and receipt files must never disappear ahead of their financial references. */
export default function recoverable(schema) {
  schema.add({ is_deleted: { type: Boolean, default: false, index: true }, deleted_at: { type: Date, default: null } });
  schema.query.withDeleted = function () { this._withDeleted = true; return this; };
  schema.pre(/^(find|countDocuments|update)/, function () {
    if (!this._withDeleted && this.getFilter().is_deleted === undefined) this.where({ is_deleted: { $ne: true } });
  });
  schema.pre('aggregate', function () {
    this.pipeline().unshift({ $match: { is_deleted: { $ne: true } } });
  });
}
