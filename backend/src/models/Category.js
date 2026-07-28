import mongoose from 'mongoose';

const { Schema } = mongoose;

const categorySchema = new Schema(
  {
    /** PUBLIC_SPACE_ID for global categories. */
    spaceId: { type: Schema.Types.ObjectId, ref: 'Space', required: true },
    name: { type: String, required: true, trim: true, maxlength: 60 },
    slug: { type: String, required: true, lowercase: true, trim: true },
    order: { type: Number, default: 0 },
    iconUrl: { type: String },
    /** design.md §12 — the generated topic-cover fallback uses this. */
    color: { type: String, default: '#2A4E5C' },
    status: { type: String, enum: ['active', 'archived'], default: 'active' },
  },
  { timestamps: true },
);

categorySchema.index({ spaceId: 1, order: 1 });
categorySchema.index({ spaceId: 1, slug: 1 }, { unique: true });

export const Category = mongoose.model('Category', categorySchema);
