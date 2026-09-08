import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { exportCareEvents } from '../backend/care-event-export.mjs';
import { exportGutPacerRecords } from '../backend/care-event-contract.mjs';
const html=readFileSync(new URL('../frontend/index.html',import.meta.url),'utf8');
const ctx=vm.createContext({});
vm.runInContext(html.slice(html.indexOf('        function bowelStatus('),html.indexOf('        function captureLogForm(')),ctx);
const context={authenticated:true,householdId:'synthetic-household',patientId:'synthetic-patient',timezoneOffset:'+09:00',exportedAt:'2026-09-08T12:00:00+09:00'};
for(const [name,fields,expected] of [
    ['unselected', {hasStool:false,bowel:null,bowelConfirmedNone:false}, 'not_recorded'],
    ['legacy false', {hasStool:false,bowel:null}, 'not_recorded'],
    ['legacy missing', {}, 'not_recorded'],
    ['explicit absence', {hasStool:false,bowel:null,bowelConfirmedNone:true}, 'confirmed_none'],
    ['observed', {hasStool:true,bowel:{amount:'小 (S)',type:'普通（バナナ状）'}}, 'observed'],
]) {
    test(`UI and both exports agree: ${name}`,()=>{
        const record={fullDate:'2026-09-08',...fields};
        assert.equal(ctx.bowelStatus(record),expected);
        assert.equal(exportCareEvents([record],'synthetic-household').events.find(e=>e.eventType==='bowel_movement').missingness,expected);
        assert.equal(exportGutPacerRecords([record],context).find(e=>e.eventType==='bowel_movement').missingness,expected);
    });
}
