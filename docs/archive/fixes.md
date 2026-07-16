Please update the system architecture and add the following missing fields to the Contact entity. 
Ensure that editing capabilities are implemented for each item in the system, 
and that all picklist fields are manageable via the Admin role.
The word in hebrew is the metadata of field. it is the name in hebrew this name shoild go to localization table. the definition in () is the data type .
The design should be displayed correctly on mobile phones! add all this to paln and only after planning execute

### 1. New & Updated Fields for Contact Entity:
* **Area** (`picklist`) / אזור
* **First Visit** (`datetime`) / ביקור ראשון
* **Potential for Next Step** (`picklist`) / פוטנציאל לצעד
* **Tefillin** (`boolean`) / תפילין
* **Charity** (`boolean`) / צדקה
* **Charity_note** (`text`) / הערה צדקה
* **Candles** (`boolean`) / נרות
* **Newsletter** (`boolean`) / עלון
* **Torah_Thought** (`picklist`) / דבר תורה
* **Letter_Torah** (`boolean`) / אות בספר
* **Letter_Torah_notes** (`text`) / הערה אות בספר
* **Rebbe_Connection** (`text`) / קשר לרבי
* **Recommendations** (`text`) / המלצות
* **Background** (`text`) / רקע

### 2. Required System Functionality:
* **CRUD / Editing Capability:** Every single field listed above must have an explicit editing mechanism (UI inputs/forms and API endpoints) built into the system for users.
* **Role-Based Access Control (RBAC):** All fields marked as `picklist` (Area, Potential for Next Step, Torah_Thought) must have their configuration options globally manageable only by users holding the **Admin role**.
