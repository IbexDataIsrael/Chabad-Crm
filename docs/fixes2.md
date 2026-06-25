Please update the system architecture and add the following missing or change current structure.

All picklist values should be in one table. fields
* **id** (`GUID`) 
* **table_name** (`text`)  / שם טבלה
* **field_name** (`text`) / שם  שדה
* **value** (`text`) / ערך 
When server fetches the data it will fetch these fields


Add new tables as follows:
New table : Areas
will have the following fields (Hebrew titles should be placed in the localisation table)
Fields:
* **id** (`GUID`) 
* **area _name ** (`text `) / כותרת  
* **area _notes ** (`text `) / הערות 
* **area _polygon** (`text `) / תחום פוליגון 


New table called buildings that will have the following fields (Hebrew titles should be placed in the localisation table)
Fields:
* **id** (`GUID`) 
* **area_id** (`GUID`) / שם אזור 
* **building_name ** (`text`) / שם בניין 
* **building address ** (`text `) / כתובת בניין 
* **longtitude** (`float`) 
* **latitude** (`float `) 
New table : apartments that will have the following fields (Hebrew titles should be placed in the localisation table)
Fields:
* **id** (`GUID`) 
* **building_id ** (`GUID`) / שם בניין 
* **apartment _name ** (`text `) / כותרת  
* **apartment _notes ** (`text `) / הערות 



Major change to the Contact entity. 
There will be another type of contact called Shliach . a Shliach will also have a role in the system and will be able to log in. the regular contact we have now will be called mekurav
Modify the Contact entity to hold only general CRM fields 
Name , last , address, email , phone and so on 

Fields to add to Contact table:
* **Contact_id** (`GUID`)
* **Contact_type** (`picklist`)  / סוג איש קשר
Picklist Contact_type: values  are (מקורב, שליח)

new table: Contact_mekurav to hold the data that is not standard CRM contact data, that we have now (like Tefilin and other fields)
fields add to Contact_mekurav table:
 * **Contact_id** (`GUID`) this will connect to the Contact
* **apartment_id** (`GUID`)  / דירה

new table: Contact_shliach to hold the data of shliach
fields add to Contact_mekurav table:
 * **Contact_id** (`GUID`) this will connect to the Contact
* **notes** (`text`)  / הערות


New table : Contact_shliach_apartment
This is the relation of Contact_shliach to  apartment 
Fields:
* **id** (`GUID`) 
* **Contact_mekurav_id** (`GUID`) 
* **special_date_id** (`GUID`) 


Add a new table called significant_dates that will have the following fields (Hebrew titles should be placed in the localisation table)
* **id** (`GUID`) 
* **special_date ** (`datetime`) / תאריך חשוב
* **hebrew_date ** (`text`) / תאריך עברי 
* **special_date_type ** (`picklist`) / סוג תאריך 
* **special_date_title ** (`picklist`) / כותרת 
* **is_set_reminder ** (`boolean`) / האם לשלוח תזכורת 
Picklist special_date_type values (יום הולדת , תאריך פטירה )

New table : Contact_mekurav_ special_date 
This is the relation of special_date to  Contact_mekurav
Fields:
* **id** (`GUID`) 
* **Contact_mekurav_id** (`GUID`) 
* **special_date_id** (`GUID`) 



### 2. Required System Functionality:
* **new behaviours of system** a new button will appear for admin new feature shliach_contact
“add_Shliach” the localization text is “הוסף שליח”
This will open the contact fields + shliach_contact fileds.
A dynamic smart client will enable associating a shliach_contact
 With  a number of apartments. An add button called “הוסף דירה” will open an autocomplete textbox to enable easy selection of apartments. 

Make an option to add buildings (based on table above)
New behaviour of adding mekurav_contact:
Add apartment. this will enable the selection of the building
The selection of an address will open the option to add apartment. The address including long and lat will be copied to the newly created apartment entity . this should be editable 
Special_date can be added to mekurav_contact dynamically. 
Make sure editing is possible – removing a special_date or editing an existing special_date
Areas page – list of all areas and enable editing. Add area – based on data above ask ne questions if not understood. 
All Shluchim_contact associated with area will be displayed in list . a click on contact will take user to contact page
Building page – based on data above ask ne questions if not understood
Adding apartment will be done from within the Mekurav contact form

System should support CRUD for all new entities
More notes:
All dates in the system should open a calendar and not the way it is done now!
All logins to systems should be via google login system

* **Role-Based Access Control (RBAC):** 
A new role is added that is not admin called Shliach
