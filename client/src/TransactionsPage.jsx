import { Fragment, useCallback, useEffect, useState } from 'react';
import { authHeaders, isSignedIn } from './auth.js';
import {
  enqueue, flush, pendingCount, failedCount, pending, retry, clearFailed,
  FLUSH_INTERVAL_MS,
} from './offlineQueue.js';
import ReceiptAttachments from './ReceiptAttachments.jsx';
import SignInRequired from './SignInRequired.jsx';
import {
  ATTACHMENT_ACCEPT,
  ATTACHMENT_RULES,
  MAX_ATTACHMENTS,
  checkAttachment,
  uploadAttachment,
} from './receipts.js';

const API = `${import.meta.env.VITE_API_URL || 'http://localhost:5000'}/api`;
const PAGE_SIZE = 25;

const emptyFilters = {
  startDate: '',
  endDate: '',
  accountId: '',
  categoryId: '',
  type: '',
  tag: '',
  minAmount: '',
  maxAmount: '',
  search: '',
};

const emptyPagination = {
  page: 1,
  limit: PAGE_SIZE,
  totalItems: 0,
  totalPages: 0,
};

function today() {
  const date = new Date();

  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');
}

function listFrom(result, key) {
  if (Array.isArray(result?.[key])) return result[key];
  if (Array.isArray(result?.data?.[key])) return result.data[key];
  if (Array.isArray(result?.data)) return result.data;

  return [];
}

function optionId(item) {
  return String(item?.id ?? item?._id ?? '');
}

async function apiRequest(path, options = {}) {
  const response = await fetch(`${API}/${path}`, {
    ...options,
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...authHeaders(),
      ...options.headers,
    },
  });

  const result = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(result.message || 'Request failed.');
  }

  return result;
}

const fieldStyle = {
  width: '100%',
  boxSizing: 'border-box',
  padding: 10,
  marginTop: 5,
  borderRadius: 6,
  border: '1px solid #475569',
  background: '#111827',
  color: '#f8fafc',
};

const labelStyle = {
  display: 'block',
  color: '#cbd5e1',
  fontSize: 13,
  marginBottom: 12,
};