import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

const { NODE_ENV, DEV_DB_URL, PREPROD_DB_URL, PROD_DB_URL } = process.env;

const getMongoURI = (): string => {
  switch (NODE_ENV) {
    case 'dev': return DEV_DB_URL as string;
    case 'preprod': return PREPROD_DB_URL as string;
    case 'prod': return PROD_DB_URL as string;
    default: throw new Error('NODE_ENV must be dev | preprod | prod');
  }
};

const AdminSchema = new mongoose.Schema(
  { name: { type: String, required: true }, role: { type: String, default: 'Admin' }, phone: { type: String, required: true, unique: true } },
  { versionKey: false }
);
const Admin = mongoose.models.Admin || mongoose.model('Admin', AdminSchema);

const ADMINS = [
  { phone: '9850929698', name: 'Platform Admin' },
  { phone: '9850929634', name: 'Platform Admin' },
];

async function seed() {
  await mongoose.connect(getMongoURI());
  console.log(`✅ Connected [${NODE_ENV}]`);

  for (const admin of ADMINS) {
    const result = await Admin.findOneAndUpdate(
      { phone: admin.phone },
      { $setOnInsert: admin },
      { upsert: true, new: true }
    );
    console.log(`✅ Admin ${admin.phone}: ${result._id} (upserted)`);
  }

  await mongoose.disconnect();
  console.log('Done.');
}

seed().catch(err => { console.error(err); process.exit(1); });
