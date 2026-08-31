This is not an instruction file . I want to consult since I don’t know the best way to do it. I am writing my thoughts and want you to make plan55.md !
Short explanation about the purpose of activist system:
The activists use the system for campaigns. A campaign, for example, is the Jewish holiday of Hannuka . The activists use the list of apartments and fo to each apartment on the list.

We  should add an entity called campaign and an entity called task , for this new sql tables should be created + sql table for the relation between activist and task
Campaign table
•	Id 
•	Name 
•	Date created 
Task table
•	Id
•	Task status : completed / partial_complete/ not completed 
Report_task table
•	Id
•	Task id 
•	Report id

Activist_task table 
•	Id 
•	contactShliach id 
•	task id

 Instead of binding an activist to a report we want to bind him to a task . a task can have one or more reports 

When connecting a report to an activist the system should create a task . if another report is added within X minutes it should be in the same task. The X number of minutes should be in configuration section. Default is 10 minutes 
On activist display:  If there are more than 1 report in a task make dividers distinguishing the different tasks 
When an activist marks a task as not done we must know what apartments he visited and what he did not . hence a checkbox should be added to mark if done .  near each apartment and we must tell the activist to Mark the apartments that are not done . 
When an activist (a different one or the same one) opens the system, done tasks should be marked to avoid doing the same apartment twice
This probably needs another sql table . what do you suggest? How to display it in admin system ? 
How do you suggest working with the campaign? in active system / admin system
HISTORY
We want to capture the change in Mivtsoim in each campaign/task… how should we go about this?
We want another section in Activist display showing his history , what he did even after task is completed how should we go about this?

