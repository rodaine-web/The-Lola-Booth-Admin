import test from 'node:test';
import assert from 'node:assert/strict';
import {calendarCells} from '../src/utils/calendar-grid.js';

test('month calendar includes leap day and fills the boundary weeks',()=>{
 const cells=calendarCells('2024-02-29','month');
 assert.equal(cells[0],'2024-01-28');assert.equal(cells.at(-1),'2024-03-02');
 assert.ok(cells.includes('2024-02-29'));assert.equal(cells.length,35);
 assert.equal(new Set(cells).size,cells.length);
});
test('six-week month retains every day, including the last Monday',()=>{
 const cells=calendarCells('2026-08-15','month');
 assert.equal(cells.length,42);assert.equal(cells[0],'2026-07-26');assert.equal(cells.at(-1),'2026-09-05');
 assert.ok(cells.includes('2026-08-31'));
});
test('week calendar respects the business range supplied by the API',()=>{
 assert.deepEqual(calendarCells('2026-10-02','week',{startDate:'2026-09-28'}),['2026-09-28','2026-09-29','2026-09-30','2026-10-01','2026-10-02','2026-10-03','2026-10-04']);
});
test('day calendar preserves the selected date and invalid input produces no cells',()=>{
 assert.deepEqual(calendarCells('2026-10-02','day'),['2026-10-02']);
 assert.deepEqual(calendarCells('','month'),[]);
});
