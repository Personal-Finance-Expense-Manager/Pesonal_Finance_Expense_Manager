import User from '../src/models/User.js';
import Account from '../src/models/Account.js';
import Category from '../src/models/Category.js';
import Transaction from '../src/models/Transaction.js';
import Transfer from '../src/models/Transfer.js';
import Tag from '../src/models/Tag.js';
import TransactionTag from '../src/models/TransactionTag.js';
import Budget from '../src/models/Budget.js';
import Goal from '../src/models/Goal.js';
import GoalContribution from '../src/models/GoalContribution.js';
import RecurringRule from '../src/models/RecurringRule.js';
import Reminder from '../src/models/Reminder.js';
import Attachment from '../src/models/Attachment.js';
import Notification from '../src/models/Notification.js';
import AuditLog from '../src/models/AuditLog.js';
import { money, toDecimal128 } from '../src/utils/money.js';

const models = [
  User, Account, Category, Transaction, Transfer, Tag,
  TransactionTag, Budget, Goal, GoalContribution,
  RecurringRule, Reminder, Attachment, Notification, AuditLog,
];

for (const model of models) {
  if (!model.modelName || !model.schema) {
    throw new Error('A model failed to load.');
  }
  console.log(`PASS ${model.modelName}`);
}

console.log('Money rounding:', money('12.345').toFixed(2));
console.log('Decimal128:', toDecimal128('125.50').toString());
console.log(`Total models loaded: ${models.length}`);
