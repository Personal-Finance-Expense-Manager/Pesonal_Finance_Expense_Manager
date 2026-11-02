import PDFDocument from 'pdfkit';

/**
 * The period report as a PDF - US-22 (#51), SRS 5.8: REQ-77.
 *
 * REQ-77 requires the exported figures to be identical to the ones displayed.
 * This renders the very same report object the API returned to the screen, and
 * formats nothing that was not already computed there - every amount and
 * percentage is printed as the server produced it, so the two cannot drift.
 *
 * pdfkit is used rather than a hand-rolled writer: a PDF's cross-reference
 * table is unforgiving, and a malformed file would be worse than the
 * dependency. The built-in Helvetica faces keep the file small and need no
 * embedded font.
 */

const MARGIN = 48;
const RULE = '#cccccc';
const MUTED = '#666666';
const UP = '#b42318';
const DOWN = '#027a48';

function formatDate(value) {
  return new Date(value).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/** Amounts are printed exactly as the report computed them (BR-4). */
function money(amount) {
  const value = Number(amount);
  const sign = value < 0 ? '-' : '';
  const fixed = Math.abs(value).toFixed(2);
  const [whole, fraction] = fixed.split('.');

  // Indian digit grouping: the last three digits, then pairs.
  const last = whole.slice(-3);
  const rest = whole.slice(0, -3);
  const grouped = rest ? `${rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',')},${last}` : last;

  return `${sign}Rs ${grouped}.${fraction}`;
}

function arrow(direction) {
  if (direction === 'up') return '+';
  if (direction === 'down') return '-';
  return '=';
}

function changeText(change) {
  if (!change) return '';
  const percent = change.percent === null ? 'n/a' : `${Math.abs(change.percent)}%`;
  return `${arrow(change.direction)}${money(Math.abs(Number(change.amount))).replace('Rs ', '')} (${percent})`;
}

function changeColour(direction) {
  if (direction === 'up') return UP;
  if (direction === 'down') return DOWN;
  return MUTED;
}

/** One row of the category table, with the columns the layout defines. */
function tableRow(doc, columns, values, { bold = false, colours = {} } = {}) {
  const y = doc.y;

  values.forEach((value, index) => {
    const column = columns[index];
    doc
      .font(bold ? 'Helvetica-Bold' : 'Helvetica')
      .fontSize(9.5)
      .fillColor(colours[index] || '#000000')
      .text(String(value), column.x, y, { width: column.width, align: column.align });
  });

  doc.fillColor('#000000');
  doc.x = MARGIN;
  doc.y = y + 16;
}

function rule(doc) {
  doc
    .moveTo(MARGIN, doc.y)
    .lineTo(doc.page.width - MARGIN, doc.y)
    .strokeColor(RULE)
    .lineWidth(0.5)
    .stroke();
  doc.x = MARGIN;
  doc.y += 8;
}

/**
 * Render the report and resolve with the finished PDF as a Buffer.
 *
 * The whole document is held in memory deliberately: a period report is a page
 * or two, and buffering lets the route send a Content-Length and fail cleanly
 * rather than part-way through a stream.
 */
export function reportToPdf(report, { userName = '', generatedAt = new Date() } = {}) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: MARGIN, info: { Title: 'Spending report' } });
    const chunks = [];

    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const comparing = Boolean(report.compare);
    const contentWidth = doc.page.width - MARGIN * 2;

    // ---- heading ------------------------------------------------------
    doc.font('Helvetica-Bold').fontSize(18).text('Spending report');
    doc.moveDown(0.2);
    doc
      .font('Helvetica')
      .fontSize(10)
      .fillColor(MUTED)
      .text(`${formatDate(report.from)} to ${formatDate(report.to)}`);

    if (userName) doc.text(userName);
    doc.text(`Generated ${formatDate(generatedAt)} - Personal Finance & Expense Manager`);
    doc.fillColor('#000000');
    doc.moveDown(1);

    // ---- totals -------------------------------------------------------
    rule(doc);
    const figures = [
      ['Total income', money(report.total_income)],
      ['Total expense', money(report.total_expense)],
      ['Net', money(report.net)],
      ['Transactions', String(report.transaction_count)],
    ];

    const boxWidth = contentWidth / figures.length;
    const figuresTop = doc.y;

    figures.forEach(([label, value], index) => {
      const x = MARGIN + boxWidth * index;
      doc.font('Helvetica').fontSize(8.5).fillColor(MUTED)
        .text(label.toUpperCase(), x, figuresTop, { width: boxWidth });
      doc.font('Helvetica-Bold').fontSize(12).fillColor('#000000')
        .text(value, x, figuresTop + 12, { width: boxWidth });
    });

    // The figures were written at explicit column positions, which leaves the
    // cursor in the last column; everything after this is full width, so put
    // it back on the left margin.
    doc.x = MARGIN;
    doc.y = figuresTop + 38;
    rule(doc);

    // ---- projection (REQ-76) -----------------------------------------
    doc.font('Helvetica-Bold').fontSize(11).text('Pace of spending');
    doc.moveDown(0.3);
    doc.font('Helvetica').fontSize(9.5).fillColor(MUTED);
    doc.text(
      `Average daily spend ${money(report.projection.average_daily_spend)} over ` +
        `${report.projection.elapsed_days} of ${report.projection.total_days} days.`
    );
    doc.text(
      report.projection.is_complete
        ? 'The period is complete, so the projected total is the actual total.'
        : 'Projected total if spending continues at this rate: ' +
            `${money(report.projection.projected_total)}.`
    );
    doc.fillColor('#000000');
    doc.moveDown(1);

    // ---- comparison (REQ-75) -----------------------------------------
    if (comparing) {
      rule(doc);
      doc.font('Helvetica-Bold').fontSize(11).text('Compared with');
      doc.moveDown(0.3);
      doc.font('Helvetica').fontSize(9.5).fillColor(MUTED)
        .text(`${formatDate(report.compare.from)} to ${formatDate(report.compare.to)}`);
      doc.fillColor('#000000');
      doc.moveDown(0.4);

      const change = report.compare.change.total_expense;
      doc.font('Helvetica').fontSize(9.5)
        .text('Expense ', { continued: true })
        .text(`${money(report.compare.total_expense)} -> ${money(report.total_expense)}  `, { continued: true })
        .fillColor(changeColour(change.direction))
        .text(changeText(change))
        .fillColor('#000000');
      doc.moveDown(1);
    }

    // ---- category table (REQ-73, REQ-75) ------------------------------
    rule(doc);
    doc.font('Helvetica-Bold').fontSize(11).text('By category');
    doc.moveDown(0.5);

    const columns = comparing
      ? [
          { x: MARGIN, width: 150, align: 'left' },
          { x: MARGIN + 150, width: 90, align: 'right' },
          { x: MARGIN + 240, width: 55, align: 'right' },
          { x: MARGIN + 295, width: 90, align: 'right' },
          { x: MARGIN + 385, width: contentWidth - 385, align: 'right' },
        ]
      : [
          { x: MARGIN, width: 220, align: 'left' },
          { x: MARGIN + 220, width: 110, align: 'right' },
          { x: MARGIN + 330, width: 70, align: 'right' },
          { x: MARGIN + 400, width: contentWidth - 400, align: 'right' },
        ];

    tableRow(
      doc,
      columns,
      comparing
        ? ['Category', 'Amount', 'Share', 'Previous', 'Change']
        : ['Category', 'Amount', 'Share', 'Transactions'],
      { bold: true }
    );
    rule(doc);

    if (report.by_category.length === 0) {
      // REQ-74: a report with no data says so, rather than printing an empty
      // table or failing.
      doc.font('Helvetica').fontSize(10).fillColor(MUTED)
        .text('No expenses were recorded in this period. Record a transaction, or choose a wider date range.');
      doc.fillColor('#000000');
    } else {
      for (const row of report.by_category) {
        // Start a new page before a row would run off the bottom.
        if (doc.y > doc.page.height - MARGIN - 40) {
          doc.addPage();
        }

        tableRow(
          doc,
          columns,
          comparing
            ? [row.name, money(row.amount), `${row.share_percent}%`, money(row.previous_amount), changeText(row.change)]
            : [row.name, money(row.amount), `${row.share_percent}%`, String(row.transaction_count)],
          comparing ? { colours: { 4: changeColour(row.change.direction) } } : {}
        );
      }

      rule(doc);
      tableRow(
        doc,
        columns,
        comparing
          ? ['Total', money(report.total_expense), '100%', money(report.compare.total_expense), changeText(report.compare.change.total_expense)]
          : ['Total', money(report.total_expense), '100%', String(report.transaction_count)],
        { bold: true }
      );
    }

    doc.end();
  });
}
