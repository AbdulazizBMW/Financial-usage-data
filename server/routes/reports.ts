import { Router } from 'express';
import PDFDocument from 'pdfkit';
import ExcelJS from 'exceljs';
import { getAuth } from '../auth.js';
import { asyncHandler, notFound } from '../http.js';
import { buildMonthly, type MonthlyData } from '../finance.js';
import { getUserBase } from '../finance.js';
import { dec, money, monthLabel, parseMonth, todayISO } from '../money.js';

export const reportsRouter = Router();

interface ReportContext {
  monthly: MonthlyData;
  user: { name: string; email: string };
  generatedAt: string;
}

async function loadReport(req: Parameters<Parameters<typeof asyncHandler>[0]>[0]): Promise<ReportContext> {
  const { db, user } = getAuth(req);
  const monthParam = typeof req.query.month === 'string' ? req.query.month : undefined;
  const { year, month } = parseMonth(monthParam ?? todayISO().slice(0, 7));
  const base = await getUserBase(db, user.id);
  const monthly = await buildMonthly(db, user.id, year, month, base);
  return {
    monthly,
    user: { name: user.name, email: user.email },
    generatedAt: new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC'
  };
}

function moneyText(value: string, currency: string): string {
  return `${Number(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
}

function statusLabel(status: string): string {
  return status.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

/* ------------------------------------------------------------------------- PDF */

function pdfTable(
  doc: PDFKit.PDFDocument,
  headers: string[],
  rows: string[][],
  widths: number[],
  opts: { align?: ('left' | 'right')[]; empty?: string } = {}
) {
  const startX = doc.page.margins.left;
  const bottom = doc.page.height - doc.page.margins.bottom - 20;
  const drawHeader = () => {
    doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#334155');
    let x = startX;
    headers.forEach((h, i) => {
      doc.text(h.toUpperCase(), x, doc.y, { width: widths[i], align: opts.align?.[i] ?? 'left' });
      x += widths[i];
    });
    doc.moveDown(0.25);
    doc
      .moveTo(startX, doc.y)
      .lineTo(startX + widths.reduce((a, b) => a + b, 0), doc.y)
      .strokeColor('#cbd5e1')
      .lineWidth(0.6)
      .stroke();
    doc.moveDown(0.3);
  };

  if (!rows.length) {
    doc.font('Helvetica-Oblique').fontSize(8.5).fillColor('#64748b');
    doc.text(opts.empty ?? 'No records for this period.', startX, doc.y, {
      width: widths.reduce((a, b) => a + b, 0)
    });
    doc.moveDown(0.5);
    return;
  }

  drawHeader();
  for (const row of rows) {
    const height = Math.max(
      ...row.map((cell, i) => doc.heightOfString(cell, { width: widths[i] - 4 })),
      11
    );
    if (doc.y + height > bottom) {
      doc.addPage();
      drawHeader();
    }
    const y = doc.y;
    doc.font('Helvetica').fontSize(8.5).fillColor('#0f172a');
    let x = startX;
    row.forEach((cell, i) => {
      doc.text(cell, x, y, { width: widths[i] - 4, align: opts.align?.[i] ?? 'left' });
      x += widths[i];
    });
    doc.y = y + height + 3;
    doc
      .moveTo(startX, doc.y - 1)
      .lineTo(startX + widths.reduce((a, b) => a + b, 0), doc.y - 1)
      .strokeColor('#e2e8f0')
      .lineWidth(0.4)
      .stroke();
    doc.moveDown(0.15);
  }
}

function sectionTitle(doc: PDFKit.PDFDocument, text: string) {
  const bottom = doc.page.height - doc.page.margins.bottom - 60;
  if (doc.y > bottom) doc.addPage();
  doc.moveDown(0.6);
  doc.font('Helvetica-Bold').fontSize(11).fillColor('#1d4ed8').text(text.toUpperCase(), { characterSpacing: 0.4 });
  doc.moveDown(0.3);
}

function summaryGrid(doc: PDFKit.PDFDocument, items: { label: string; value: string; tone?: 'pos' | 'neg' }[]) {
  const startX = doc.page.margins.left;
  const width = (doc.page.width - doc.page.margins.left - doc.page.margins.right) / 2 - 8;
  const startY = doc.y;
  let y = startY;
  items.forEach((item, index) => {
    const x = index % 2 === 0 ? startX : startX + width + 16;
    if (index % 2 === 0 && index > 0) y += 34;
    if (y + 30 > doc.page.height - doc.page.margins.bottom) {
      doc.addPage();
      y = doc.y;
    }
    doc.roundedRect(x, y, width, 28, 4).fillAndStroke('#f8fafc', '#e2e8f0');
    doc.font('Helvetica').fontSize(7.5).fillColor('#64748b').text(item.label, x + 8, y + 5, { width: width - 16 });
    doc
      .font('Helvetica-Bold')
      .fontSize(10)
      .fillColor(item.tone === 'neg' ? '#b91c1c' : item.tone === 'pos' ? '#047857' : '#0f172a')
      .text(item.value, x + 8, y + 15, { width: width - 16, align: 'right' });
  });
  doc.y = y + 36;
}

function barChart(
  doc: PDFKit.PDFDocument,
  data: { label: string; a: number; b: number }[],
  legend: [string, string],
  currency: string
) {
  if (!data.length) return;
  const x0 = doc.page.margins.left + 30;
  const chartWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right - 40;
  const chartHeight = 120;
  const bottom = doc.page.height - doc.page.margins.bottom - 40;
  if (doc.y + chartHeight + 40 > bottom) doc.addPage();
  const top = doc.y + 14;
  const max = Math.max(...data.map((d) => Math.max(d.a, d.b)), 1);
  const slot = chartWidth / data.length;
  const barWidth = Math.min(18, slot / 3);

  doc.font('Helvetica-Bold').fontSize(8).fillColor('#334155');
  doc.text(`${legend[0]} (blue) vs ${legend[1]} (red), ${currency}`, x0, top - 12, { width: chartWidth });

  doc
    .moveTo(x0, top)
    .lineTo(x0, top + chartHeight)
    .lineTo(x0 + chartWidth, top + chartHeight)
    .strokeColor('#cbd5e1')
    .lineWidth(0.8)
    .stroke();

  data.forEach((d, i) => {
    const cx = x0 + slot * i + slot / 2;
    const aH = (d.a / max) * (chartHeight - 12);
    const bH = (d.b / max) * (chartHeight - 12);
    doc.rect(cx - barWidth - 1, top + chartHeight - aH, barWidth, aH).fill('#3384fb');
    doc.rect(cx + 1, top + chartHeight - bH, barWidth, bH).fill('#ef4444');
    doc
      .font('Helvetica')
      .fontSize(6.5)
      .fillColor('#64748b')
      .text(d.label, cx - slot / 2, top + chartHeight + 4, { width: slot, align: 'center' });
  });
  doc.y = top + chartHeight + 20;
}

function horizontalBars(doc: PDFKit.PDFDocument, data: { label: string; value: number }[], currency: string) {
  if (!data.length) return;
  const x0 = doc.page.margins.left;
  const width = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const max = Math.max(...data.map((d) => d.value), 1);
  data.slice(0, 8).forEach((d) => {
    if (doc.y + 18 > doc.page.height - doc.page.margins.bottom - 20) doc.addPage();
    const y = doc.y;
    doc.font('Helvetica').fontSize(8).fillColor('#334155').text(d.label, x0, y, { width: width * 0.42 });
    const barX = x0 + width * 0.44;
    const barW = width * 0.4;
    doc.rect(barX, y + 1, barW, 8).fill('#f1f5f9');
    doc.rect(barX, y + 1, Math.max(2, (d.value / max) * barW), 8).fill('#1d4ed8');
    doc
      .font('Helvetica-Bold')
      .fontSize(7.5)
      .fillColor('#0f172a')
      .text(moneyText(String(d.value), currency), barX + barW + 6, y, { width: width * 0.14, align: 'right' });
    doc.y = y + 14;
  });
}

function renderPdf(ctx: ReportContext): Promise<Buffer> {
  const { monthly, user, generatedAt } = ctx;
  const base = monthly.baseCurrency;
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 40, bufferPages: true, info: { Title: `Monthly financial report ${monthly.label}` } });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // Cover header band
    doc.rect(0, 0, doc.page.width, 92).fill('#0f172a');
    doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(19).text('FINORA', 40, 30, { characterSpacing: 2 });
    doc.font('Helvetica').fontSize(9.5).fillColor('#cbd5e1').text('Monthly Financial Report', 40, 56);
    doc
      .font('Helvetica-Bold')
      .fontSize(11)
      .fillColor('#ffffff')
      .text(monthly.label, 0, 34, { align: 'right', width: doc.page.width - 40 });
    doc.font('Helvetica').fontSize(8).fillColor('#94a3b8').text(`Generated ${generatedAt}`, 0, 54, {
      align: 'right',
      width: doc.page.width - 40
    });
    doc.y = 112;

    doc.font('Helvetica-Bold').fontSize(12).fillColor('#0f172a').text(user.name);
    doc.font('Helvetica').fontSize(9).fillColor('#475569').text(user.email);
    doc.moveDown(0.3);
    doc.font('Helvetica').fontSize(8.5).fillColor('#64748b').text(
      `Reporting period: ${monthly.from} to ${monthly.to} · Base currency: ${base} · All amounts in ${base} unless stated`
    );

    sectionTitle(doc, 'Executive summary');
    summaryGrid(doc, [
      { label: 'Opening balance', value: moneyText(monthly.openingBalance, base) },
      { label: 'Total income', value: moneyText(monthly.income, base), tone: 'pos' },
      { label: 'Total expenses', value: moneyText(monthly.expenses, base), tone: 'neg' },
      {
        label: 'Net cash flow',
        value: moneyText(monthly.netCashFlow, base),
        tone: dec(monthly.netCashFlow).gte(0) ? 'pos' : 'neg'
      },
      { label: 'Closing balance', value: moneyText(monthly.closingBalance, base) },
      { label: 'Total savings', value: moneyText(monthly.savings, base) },
      { label: 'Savings rate', value: `${monthly.savingsRate}%` },
      { label: 'Outstanding receivables', value: moneyText(monthly.receivables, base) },
      { label: 'Outstanding payables', value: moneyText(monthly.payables, base) },
      { label: 'Money lent this month', value: moneyText(monthly.lentInMonth, base) },
      { label: 'Money borrowed this month', value: moneyText(monthly.borrowedInMonth, base) },
      { label: 'Repayments received / paid', value: `${moneyText(monthly.repaymentsReceived, base)} / ${moneyText(monthly.repaymentsPaid, base)}` }
    ]);

    sectionTitle(doc, 'Financial charts');
    barChart(
      doc,
      monthly.trend.map((t) => ({ label: t.label.split(' ')[0].slice(0, 3), a: Number(t.income), b: Number(t.expense) })),
      ['Income', 'Expenses'],
      base
    );
    doc.moveDown(0.4);
    doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#334155').text('Expenses by category', { continued: false });
    doc.moveDown(0.3);
    horizontalBars(
      doc,
      monthly.expenseByCategory.map((c) => ({ label: c.name, value: Number(c.total) })),
      base
    );

    sectionTitle(doc, 'Income by category');
    pdfTable(
      doc,
      ['Category', 'Records', `Amount (${base})`],
      monthly.incomeByCategory.map((c) => [c.name, String(c.count), moneyText(c.total, base)]),
      [260, 80, 175],
      { align: ['left', 'right', 'right'] }
    );

    sectionTitle(doc, 'Expenses by category');
    pdfTable(
      doc,
      ['Category', 'Records', `Amount (${base})`],
      monthly.expenseByCategory.map((c) => [c.name, String(c.count), moneyText(c.total, base)]),
      [260, 80, 175],
      { align: ['left', 'right', 'right'] }
    );

    sectionTitle(doc, 'Daily financial transactions');
    pdfTable(
      doc,
      ['Date', 'Type', 'Category', 'Account', 'Description', `Amount (${base})`],
      monthly.transactions.map((t) => [
        t.date,
        t.kind === 'transfer' ? 'Transfer' : t.kind === 'income' ? 'Income' : 'Expense',
        t.category ?? (t.kind === 'transfer' ? 'Internal transfer' : 'Uncategorised'),
        t.account,
        t.description || '—',
        t.kind === 'expense' ? `-${moneyText(t.baseAmount, base)}` : moneyText(t.baseAmount, base)
      ]),
      [58, 46, 90, 80, 165, 76],
      { align: ['left', 'left', 'left', 'left', 'left', 'right'] }
    );

    sectionTitle(doc, 'Money lent summary');
    pdfTable(
      doc,
      ['Borrower', 'Date lent', 'Amount', 'Repaid', 'Outstanding', 'Status'],
      monthly.lendLoans.map((l) => [
        l.counterparty,
        l.loan_date,
        moneyText(l.amount, l.currency),
        moneyText(l.repaid, l.currency),
        moneyText(l.outstanding, l.currency),
        statusLabel(l.status)
      ]),
      [110, 62, 90, 90, 90, 73],
      { align: ['left', 'left', 'right', 'right', 'right', 'left'], empty: 'No lending records.' }
    );

    sectionTitle(doc, 'Money borrowed summary');
    pdfTable(
      doc,
      ['Lender', 'Date borrowed', 'Amount', 'Repaid', 'Outstanding', 'Status'],
      monthly.borrowLoans.map((l) => [
        l.counterparty,
        l.loan_date,
        moneyText(l.amount, l.currency),
        moneyText(l.repaid, l.currency),
        moneyText(l.outstanding, l.currency),
        statusLabel(l.status)
      ]),
      [110, 62, 90, 90, 90, 73],
      { align: ['left', 'left', 'right', 'right', 'right', 'left'], empty: 'No borrowing records.' }
    );

    sectionTitle(doc, 'Account balances');
    pdfTable(
      doc,
      ['Account', 'Type', 'Currency', 'Opening', 'Balance', `In ${base}`],
      monthly.accounts.map((a) => [
        a.name,
        a.type,
        a.currency,
        moneyText(a.openingBalance, a.currency),
        moneyText(a.balance, a.currency),
        moneyText(a.baseBalance, base)
      ]),
      [110, 60, 55, 100, 100, 90],
      { align: ['left', 'left', 'left', 'right', 'right', 'right'] }
    );

    sectionTitle(doc, 'Short financial analysis');
    const analysis: string[] = [];
    analysis.push(
      `In ${monthly.label} you recorded income of ${moneyText(monthly.income, base)} and expenses of ${moneyText(
        monthly.expenses,
        base
      )}, giving a net cash flow of ${moneyText(monthly.netCashFlow, base)}.`
    );
    const topExpense = monthly.expenseByCategory[0];
    if (topExpense) {
      analysis.push(
        `${topExpense.name} was the largest expense category with ${moneyText(topExpense.total, base)}, representing ${
          dec(monthly.expenses).gt(0) ? money(dec(topExpense.total).div(dec(monthly.expenses)).times(100)) : '0.00'
        }% of monthly spending.`
      );
    }
    analysis.push(
      `Savings for the month were ${moneyText(monthly.savings, base)} at a savings rate of ${monthly.savingsRate}%.`
    );
    analysis.push(
      `Closing balance moved from ${moneyText(monthly.openingBalance, base)} to ${moneyText(
        monthly.closingBalance,
        base
      )}, reconciling opening balance + net cash flow + lending/borrowing movements.`
    );
    analysis.push(
      `Compared with ${monthly.comparison.previousLabel}, income was ${moneyText(
        monthly.comparison.income,
        base
      )}, expenses ${moneyText(monthly.comparison.expenses, base)} and net cash flow ${moneyText(
        monthly.comparison.netCashFlow,
        base
      )}.`
    );
    analysis.push(
      `Outstanding receivables are ${moneyText(monthly.receivables, base)} and outstanding payables are ${moneyText(
        monthly.payables,
        base
      )}. ${dec(monthly.payables).gt(0) ? 'Keep scheduled repayments in your cash-flow plan.' : 'You currently have no payables.'}`
    );
    doc.font('Helvetica').fontSize(8.8).fillColor('#1e293b');
    analysis.forEach((line) => {
      if (doc.y > doc.page.height - doc.page.margins.bottom - 60) doc.addPage();
      doc.text(`• ${line}`, { width: doc.page.width - doc.page.margins.left - doc.page.margins.right, align: 'justify' });
      doc.moveDown(0.35);
    });

    if (monthly.warnings.length) {
      doc.moveDown(0.5);
      doc.font('Helvetica-Oblique').fontSize(7.8).fillColor('#b45309');
      monthly.warnings.forEach((w) => doc.text(`Note: ${w}`));
    }

    // Page numbers
    const range = doc.bufferedPageRange();
    for (let i = 0; i < range.count; i++) {
      doc.switchToPage(range.start + i);
      doc
        .font('Helvetica')
        .fontSize(7.5)
        .fillColor('#94a3b8')
        .text(
          `Finora personal finance report · ${monthly.label} · Page ${i + 1} of ${range.count}`,
          doc.page.margins.left,
          doc.page.height - 30,
          { width: doc.page.width - doc.page.margins.left - doc.page.margins.right, align: 'center', lineBreak: false }
        );
    }
    doc.end();
  });
}

/* ------------------------------------------------------------------------ XLSX */

async function renderXlsx(ctx: ReportContext): Promise<Buffer> {
  const { monthly, user } = ctx;
  const base = monthly.baseCurrency;
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Finora';
  wb.created = new Date();

  const headerFill: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F172A' } };
  const title = (ws: ExcelJS.Worksheet, text: string) => {
    ws.mergeCells(1, 1, 1, 6);
    const cell = ws.getCell(1, 1);
    cell.value = text;
    cell.font = { bold: true, size: 13, color: { argb: 'FFFFFFFF' } };
    cell.fill = headerFill;
    ws.getRow(1).height = 24;
    ws.addRow([]);
  };
  const head = (ws: ExcelJS.Worksheet, labels: string[]) => {
    const row = ws.addRow(labels);
    row.font = { bold: true, size: 10 };
    row.eachCell((c) => {
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } };
      c.border = { bottom: { style: 'thin', color: { argb: 'FF94A3B8' } } };
    });
    return row;
  };
  const numFmt = '#,##0.00';

  /* 1. Dashboard Summary */
  const summary = wb.addWorksheet('Dashboard Summary', { views: [{ state: 'frozen', ySplit: 4 }] });
  title(summary, `Financial summary — ${monthly.label}`);
  summary.addRow(['Prepared for', user.name]);
  summary.addRow(['Email', user.email]);
  summary.addRow(['Period', `${monthly.from} to ${monthly.to}`]);
  summary.addRow(['Base currency', base]);
  summary.addRow([]);
  head(summary, ['Metric', `Amount (${base})`]);
  const metrics: [string, string][] = [
    ['Opening balance', monthly.openingBalance],
    ['Total income', monthly.income],
    ['Total expenses', monthly.expenses],
    ['Net cash flow', monthly.netCashFlow],
    ['Closing balance', monthly.closingBalance],
    ['Total savings', monthly.savings],
    ['Savings rate (%)', monthly.savingsRate],
    ['Total money lent (cumulative)', monthly.lendLoans.reduce((a, l) => a.plus(dec(l.amount)), dec(0)).toFixed(2)],
    ['Total money borrowed (cumulative)', monthly.borrowLoans.reduce((a, l) => a.plus(dec(l.amount)), dec(0)).toFixed(2)],
    ['Outstanding receivables', monthly.receivables],
    ['Outstanding payables', monthly.payables],
    ['Money lent this month', monthly.lentInMonth],
    ['Money borrowed this month', monthly.borrowedInMonth],
    ['Repayments received this month', monthly.repaymentsReceived],
    ['Repayments paid this month', monthly.repaymentsPaid]
  ];
  metrics.forEach(([label, value]) => {
    const row = summary.addRow([label, Number(value)]);
    row.getCell(2).numFmt = numFmt;
  });
  summary.addRow([]);
  head(summary, ['Month', 'Income', 'Expenses', 'Net']);
  monthly.trend.forEach((t) => {
    const row = summary.addRow([t.label, Number(t.income), Number(t.expense), Number(t.net)]);
    row.getCell(2).numFmt = numFmt;
    row.getCell(3).numFmt = numFmt;
    row.getCell(4).numFmt = numFmt;
  });
  summary.columns = [{ width: 38 }, { width: 20 }, { width: 18 }, { width: 18 }];

  /* 2. Income */
  const income = wb.addWorksheet('Income', { views: [{ state: 'frozen', ySplit: 3 }] });
  title(income, `Income transactions — ${monthly.label}`);
  head(income, ['Date', 'Category', 'Description', 'Account', 'Currency', 'Amount', `Amount (${base})`]);
  monthly.transactions
    .filter((t) => t.kind === 'income')
    .forEach((t) => {
      const row = income.addRow([t.date, t.category ?? 'Uncategorised', t.description, t.account, t.currency, Number(t.amount), Number(t.baseAmount)]);
      row.getCell(6).numFmt = numFmt;
      row.getCell(7).numFmt = numFmt;
    });
  const incomeTotal = income.addRow(['', '', '', '', 'TOTAL', '', { formula: `SUM(G4:G${income.rowCount})` }]);
  incomeTotal.font = { bold: true };
  income.columns = [{ width: 12 }, { width: 22 }, { width: 36 }, { width: 20 }, { width: 10 }, { width: 16 }, { width: 16 }];

  /* 3. Expenses */
  const expenses = wb.addWorksheet('Expenses', { views: [{ state: 'frozen', ySplit: 3 }] });
  title(expenses, `Expense transactions — ${monthly.label}`);
  head(expenses, ['Date', 'Category', 'Description', 'Account', 'Currency', 'Amount', `Amount (${base})`]);
  monthly.transactions
    .filter((t) => t.kind === 'expense')
    .forEach((t) => {
      const row = expenses.addRow([t.date, t.category ?? 'Uncategorised', t.description, t.account, t.currency, Number(t.amount), Number(t.baseAmount)]);
      row.getCell(6).numFmt = numFmt;
      row.getCell(7).numFmt = numFmt;
    });
  const expenseTotal = expenses.addRow(['', '', '', '', 'TOTAL', '', { formula: `SUM(G4:G${expenses.rowCount})` }]);
  expenseTotal.font = { bold: true };
  expenses.columns = [{ width: 12 }, { width: 22 }, { width: 36 }, { width: 20 }, { width: 10 }, { width: 16 }, { width: 16 }];

  /* 4. Lending */
  const lending = wb.addWorksheet('Lending', { views: [{ state: 'frozen', ySplit: 3 }] });
  title(lending, 'Money lent to others');
  head(lending, ['Borrower', 'Date lent', 'Due date', 'Account', 'Currency', 'Amount', 'Repaid', 'Outstanding', `Outstanding (${base})`, 'Status']);
  monthly.lendLoans.forEach((l) => {
    const row = lending.addRow([
      l.counterparty,
      l.loan_date,
      l.due_date ?? '—',
      l.account_name,
      l.currency,
      Number(l.amount),
      Number(l.repaid),
      Number(l.outstanding),
      Number(l.outstanding_base),
      statusLabel(l.status)
    ]);
    [6, 7, 8, 9].forEach((c) => (row.getCell(c).numFmt = numFmt));
  });
  lending.columns = [{ width: 24 }, { width: 12 }, { width: 12 }, { width: 20 }, { width: 10 }, { width: 16 }, { width: 16 }, { width: 16 }, { width: 18 }, { width: 16 }];

  /* 5. Borrowing */
  const borrowing = wb.addWorksheet('Borrowing', { views: [{ state: 'frozen', ySplit: 3 }] });
  title(borrowing, 'Money borrowed from others');
  head(borrowing, ['Lender', 'Date borrowed', 'Due date', 'Account', 'Currency', 'Amount', 'Repaid', 'Outstanding', `Outstanding (${base})`, 'Status']);
  monthly.borrowLoans.forEach((l) => {
    const row = borrowing.addRow([
      l.counterparty,
      l.loan_date,
      l.due_date ?? '—',
      l.account_name,
      l.currency,
      Number(l.amount),
      Number(l.repaid),
      Number(l.outstanding),
      Number(l.outstanding_base),
      statusLabel(l.status)
    ]);
    [6, 7, 8, 9].forEach((c) => (row.getCell(c).numFmt = numFmt));
  });
  borrowing.columns = [{ width: 24 }, { width: 14 }, { width: 12 }, { width: 20 }, { width: 10 }, { width: 16 }, { width: 16 }, { width: 16 }, { width: 18 }, { width: 16 }];

  /* 6. Account Balances */
  const accountsSheet = wb.addWorksheet('Account Balances');
  title(accountsSheet, `Account balances as of ${monthly.to}`);
  head(accountsSheet, ['Account', 'Type', 'Currency', 'Opening balance', 'Current balance', `Balance (${base})`]);
  monthly.accounts.forEach((a) => {
    const row = accountsSheet.addRow([a.name, a.type, a.currency, Number(a.openingBalance), Number(a.balance), Number(a.baseBalance)]);
    [4, 5, 6].forEach((c) => (row.getCell(c).numFmt = numFmt));
  });
  const totalRow = accountsSheet.addRow(['TOTAL', '', '', '', '', { formula: `SUM(F4:F${accountsSheet.rowCount})` }]);
  totalRow.font = { bold: true };
  totalRow.getCell(6).numFmt = numFmt;
  accountsSheet.columns = [{ width: 26 }, { width: 14 }, { width: 12 }, { width: 18 }, { width: 18 }, { width: 18 }];

  /* 7. Daily Transactions */
  const daily = wb.addWorksheet('Daily Transactions', { views: [{ state: 'frozen', ySplit: 3 }] });
  title(daily, `Daily transactions — ${monthly.label}`);
  head(daily, ['Date', 'Type', 'Category', 'Description', 'Account', 'Payment method', 'Currency', 'Amount', `Amount (${base})`]);
  monthly.transactions.forEach((t) => {
    const row = daily.addRow([
      t.date,
      t.kind === 'transfer' ? 'Transfer' : t.kind === 'income' ? 'Income' : 'Expense',
      t.category ?? (t.kind === 'transfer' ? 'Internal transfer' : 'Uncategorised'),
      t.description,
      t.account,
      t.paymentMethod,
      t.currency,
      Number(t.amount),
      Number(t.baseAmount)
    ]);
    row.getCell(8).numFmt = numFmt;
    row.getCell(9).numFmt = numFmt;
  });
  daily.columns = [{ width: 12 }, { width: 12 }, { width: 22 }, { width: 36 }, { width: 20 }, { width: 16 }, { width: 10 }, { width: 16 }, { width: 16 }];

  const buffer = await wb.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

/* ------------------------------------------------------------------------- CSV */

function csvEscape(value: unknown): string {
  const text = value === null || value === undefined ? '' : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/* ----------------------------------------------------------------------- routes */

reportsRouter.get(
  '/reports/monthly.pdf',
  asyncHandler(async (req, res) => {
    const ctx = await loadReport(req);
    const buffer = await renderPdf(ctx);
    const filename = `finora-report-${ctx.monthly.monthKey}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', String(buffer.length));
    res.end(buffer);
  })
);

reportsRouter.get(
  '/reports/monthly.xlsx',
  asyncHandler(async (req, res) => {
    const ctx = await loadReport(req);
    const buffer = await renderXlsx(ctx);
    const filename = `finora-report-${ctx.monthly.monthKey}.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', String(buffer.length));
    res.end(buffer);
  })
);

reportsRouter.get(
  '/reports/transactions.csv',
  asyncHandler(async (req, res) => {
    const ctx = await loadReport(req);
    const rows: string[] = [
      ['Date', 'Type', 'Category', 'Description', 'Account', 'Payment method', 'Currency', 'Amount', `Amount (${ctx.monthly.baseCurrency})`]
        .map(csvEscape)
        .join(',')
    ];
    ctx.monthly.transactions.forEach((t) => {
      rows.push(
        [
          t.date,
          t.kind,
          t.category ?? (t.kind === 'transfer' ? 'Internal transfer' : 'Uncategorised'),
          t.description,
          t.account,
          t.paymentMethod,
          t.currency,
          t.amount,
          t.baseAmount
        ]
          .map(csvEscape)
          .join(',')
      );
    });
    rows.push('');
    rows.push(['Summary', 'Value'].map(csvEscape).join(','));
    rows.push(['Reporting month', monthLabel(ctx.monthly.year, ctx.monthly.month)].map(csvEscape).join(','));
    rows.push(['Opening balance', ctx.monthly.openingBalance].map(csvEscape).join(','));
    rows.push(['Total income', ctx.monthly.income].map(csvEscape).join(','));
    rows.push(['Total expenses', ctx.monthly.expenses].map(csvEscape).join(','));
    rows.push(['Net cash flow', ctx.monthly.netCashFlow].map(csvEscape).join(','));
    rows.push(['Closing balance', ctx.monthly.closingBalance].map(csvEscape).join(','));
    rows.push(['Savings', ctx.monthly.savings].map(csvEscape).join(','));
    rows.push(['Savings rate (%)', ctx.monthly.savingsRate].map(csvEscape).join(','));
    const csv = '\uFEFF' + rows.join('\r\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="finora-transactions-${ctx.monthly.monthKey}.csv"`);
    res.end(csv);
  })
);

reportsRouter.get(
  '/reports/monthly.json',
  asyncHandler(async (req, res) => {
    const ctx = await loadReport(req);
    if (!ctx.monthly) throw notFound('No data.');
    res.json({ monthly: ctx.monthly, user: ctx.user, generatedAt: ctx.generatedAt });
  })
);
