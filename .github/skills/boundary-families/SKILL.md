---
name: boundary-families
description: Checklist of boundary data families (extremes, rule boundaries, nulls, encoding, dates, rare combinations, hostile inputs, sequences). Use it when generating or reviewing edge case data for any system, form, API, or model.
---

# Boundary families

For every field and rule, consider each family and skip one only if it does not apply.

1. **Extreme values:** minimum, maximum, zero, negative, overflow.
2. **Rule boundaries:** just below, exactly at, and just above each threshold.
3. **Empty and null:** missing, empty, whitespace only.
4. **Format and encoding:** very long text, emojis, right-to-left scripts, special characters.
5. **Dates and time:** leap years, month ends, time zones, nonexistent times.
6. **Rare valid combinations:** fields that are valid alone but almost never appear together.
7. **Hostile inputs:** injection strings and invalid values, as test text only.
8. **Sequences and volume:** bursts, duplicates, first use with no history.

## Do not use when
- There is no data, field, or rule to test.