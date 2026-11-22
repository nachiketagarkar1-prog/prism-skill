#!/usr/bin/env bash
# Regenerate the Excel exports for the bundled sample outputs.
#   scripts/build_sample_exports.sh <report-examples-dir> <deck-examples-dir>
# The examples dirs are the skills' examples/ folders (spec JSON); the PPTX files are in public/samples/decks.
set -euo pipefail
RX=${1:?report examples dir}
DX=${2:?deck examples dir}
cd "$(dirname "$0")/.."

for pair in executive_view_global:ExecutiveView_Global executive_view_north_america:ExecutiveView_NorthAmerica \
            market_snapshot_global:MarketSnapshot_Global market_snapshot_north_america:MarketSnapshot_NorthAmerica \
            opportunity_assessment_global:OpportunityAssessment_Global opportunity_assessment_north_america:OpportunityAssessment_NorthAmerica; do
  echo -n "report ${pair##*:} "
  python3 skills/gvr-report-builder/scripts/export_xlsx.py "$RX/blood_bank_${pair%%:*}.json" \
    "public/samples/reports/BloodBankSerology_${pair##*:}_v1_data.xlsx"
done

for pair in Executive_View_v3:executive_view Market_Snapshot_v3:market_snapshot Opportunity_Assessment_v3:opportunity_assessment \
            Market_Summary_v5:market_summary Competitive_Landscape_v3:competitive_landscape; do
  echo -n "presentation ${pair%%:*} "
  python3 skills/gvr-deck-builder/scripts/export_xlsx.py "public/samples/decks/GVR_BloodBank_${pair%%:*}.pptx" \
    "public/samples/decks/GVR_BloodBank_${pair%%:*}_data.xlsx" --spec "$DX/${pair##*:}.json"
done
python3 scripts/xlsx_preview.py public/samples/reports/*_data.xlsx public/samples/decks/*_data.xlsx >/dev/null
