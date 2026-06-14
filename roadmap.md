# Feature Roadmap

## simplify doesn't have or have to this extent
- better job scanning (add zero2sudo, oucka git swe, other creators, etc) 
- resume fit to job description (lets make a better algorithm than simplify)
- job matches found for you (job recommender system)
- Advanced behavioral manipulation by the user of the job agent. Allows us to fill more fields/ conditionally fill fields
- promotion algorithm to cut llm costs
- notification systems (get a text, email, live pill on your computer)

## simplify does have, but we are making it free
- ai generated resumes
- ai written responses/ written response improvement
- save multiple resumes
- insert more here

## needs improvement
- ui
- the name?
- more info from job viewer?
- resume parsing


# main areas I can see people owning after first stuff is done:
extension
- auto scan js/agentic fill
- add more supported application websites (workday, lever, greenhouse etc) 
website
- layout/ux
if cli agent:
- cli agent research
job scanning
job matching
referral network


# Payment?
- Some of the most useful simplify features are free
- maybe pay per usage for premium features?


# My current idea for ats workflow
Generic-field: A field which is structurally (in code) identical across multiple ATS. We want to find these
ATS-field: a field which is structurally identical across 1 ATS. We want to find these


For whatever ATS-field , there are 3 types of familiarity. The bot runs from most->least familiar:
1. Known Generic-field: We have programmatic code for this. No LLM
2. Known ATS-field: We have programmatic code for this. No LLM
3. Unfamiliar field: LLM
- Extension runs js in the console which broadly scans the entire page, reporting all field data about ANYTHING it can find (Whats on the page?)
- LLM then does its best to semantically map the field name to our internal representation of the field (What is this field?)
- Programmatic tools run through all the ways a given field type could be implemented, giving us the best chance of actually filling it (How do I fill the field?)
- fill is attempted, then scan runs again to show the user what it KNOWS it filled successfully (the re-scan literally sees the form is filled), 
what it THINKS it filled successfully (the tool call in theory found an implementation match, but the re-scan shows the field not filled/can't tell),
what it knows it didn't fill (no tool call match), 
of course there are also field that the originally LLM scan didn't even find. this is HITL
- All the data on what fields it found, which were filled, and which were verified to be filled successfully 
by human get placed in a data format that a coding agent can read, allowing us to *convert* unfamiliar fields to familiar fields, increasing speed/decreasing llm costs


# The first month, 7/10/26 deadline, preferably earlier. Focus hard on the ATS stuff
- Field Detection
- orchestration layer (langgraph?)
- Tool construction
- Straight up Greenhouse support 
- Human in the loop verification of results
- Field promotion (unfamiliar->familiar)


## Important engineering questions:
- How can we detect as many fields as possible on a page?
- How can we ensure the LLM reliably calls the tools? 
- How can we construct each tool such that it has the highest chance of successfully interacting with the page?
- How can we effectively convert data on unfamiliar fields to known fields (still have to deal with field matching)?


