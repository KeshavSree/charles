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


# imminent task list (implement):
- job matching algorithm 
  - instead of 1 gauge, provide multiple for different facets
  - 
- actually good resume parser 
  - less slop coded architecture, works on more resumes
  - could just be some open source tool
- better job scraping 
  - less slop coded architecture, better/more data storage, access
  - more job sites, but also the various githubs

- AI for fields that cannot be reasonably filled programmatically (free response among other things)
  - user writes sentiment, AI expands upon it option
- ICIMS support
- ashby support
- real UI work website
- real UI work extension
- integrate Hackerrank open source resume grader


# research items (define problem, evaluate usefulness, planning)
- referral network
- CLI based version? 
- payment system
- job recommendation based on resume evaluation (tinder)
- refill for employers


# Payment?
- Some of the most useful simplify features are free
- maybe pay per usage for premium features?
- Integrate existing llm they are paying for they don't have to use token costs


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



# the quality over quantity angle
- instead of focusing on 1 million jobs, focus on 
  - A: Finding jobs that arent on job boards? Like theres always ppl hiring on social media and stuff
  - B: ACTUALLY finding a good match for jobs based on more than skills, like aspirations, passions, and more
    - What does this company care about?
    - What do you care about?
    - The "Narrative profile"
  - C: taking the user past the application, all the way through to the interview. could include:
    - kanban board for jobs, in each phase we provide different support to user
    - better outreach after applying
    - metrics tracking
    - not only how to improve your resume, but how to ACTUALLY improve yourself