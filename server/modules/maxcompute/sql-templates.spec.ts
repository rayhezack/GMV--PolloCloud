import { buildDatasetSql } from './sql-templates';
import { buildAdsSql } from './ads-sql';
import { buildCreationChainSql } from './creation-chain-sql';
import { buildPaymentRegistrationSql } from './payment-registration-sql';

describe('all warehouse sync SQLs carry a final-result row-count contract', () => {
  for (const platform of ['all','web','app']) {
    for (const dataset of ['pay_type','chain','creative','renewal'] as const) {
      it(`${platform}/${dataset}`, () => {
        expect(buildDatasetSql(dataset,{platform,start:'2026-11-07',end:'2026-11-07',granularity:'daily'})).toMatch(/COUNT\(\*\) OVER\(\) AS source_row_count/i);
      });
    }
  }
  it('ads, both creation grains and payment registration', () => {
    for (const sql of [buildAdsSql('2026-11-07'), buildCreationChainSql('2026-11-07','overall'), buildCreationChainSql('2026-11-07','function'), buildPaymentRegistrationSql('2026-11-07','2026-11-07')]) {
      expect(sql).toMatch(/COUNT\(\*\) OVER\(\) AS source_row_count/i);
    }
  });
});
