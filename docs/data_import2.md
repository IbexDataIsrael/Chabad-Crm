# Import Plan: docs/data2.xlsx

Same implementation logic as `docs/apartment_data_import_plan.md`, with one modification:

* **Column C Override:** Map Column C entries to `building_type_id = 'divided_town_house'` instead of standard building type rules.

---

 **Existing Records:** If a building from Column C already exists in the database, dont add it but make a note of it