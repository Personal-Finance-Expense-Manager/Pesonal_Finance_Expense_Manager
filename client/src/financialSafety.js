export function transactionDeletionWarning(item, retentionDays = 30) {
  const identity = [item.type || 'transaction', item.amount, item.currency,
    item.transaction_date || item.transfer_date, item.note, item.id]
    .filter(Boolean).join(' · ');
  return `Move ${identity} to the recycle bin?\n\n` +
    `It can be restored within ${retentionDays} days. After that, it and its receipts are permanently purged and cannot be restored from the recycle bin.`;
}

export function financialTotalLabel(value) {
  return value == null ? 'Unavailable' : value;
}

export function goalDeletionWarning(goal) {
  return `Move "${goal.name}" to Recovery for 30 days? Its financial history and account balances will be retained.`;
}
