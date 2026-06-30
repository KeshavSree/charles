"""
Example usage of the analyzer module.

This demonstrates how to:
1. Analyze a job posting to extract ranked keywords
2. Extract resume content from database objects
3. Score how well the resume matches the job
"""

from analyzer.keyword import analyze_job_posting, transformer
from analyzer.matcher import compute_resume_fit_score
from storage.models import Profile, ProfileExperience, ProfileEducation


# Example 1: Analyze a job posting
# ================================
job_description = """
Senior Full-Stack Engineer

About the role:
We're looking for an experienced full-stack engineer to lead our platform development.

Required:
- 5+ years of Python experience
- 3+ years with React or Vue.js
- PostgreSQL and SQL optimization
- REST API design and implementation
- Experience with Docker and Linux

Preferred:
- Machine Learning or data science background
- AWS or cloud deployment experience
- GraphQL experience
- Kubernetes orchestration
- Open source contributions

Responsibilities:
- Design and implement scalable backend systems
- Build responsive, accessible frontend interfaces
- Mentor junior team members
- Participate in architecture discussions

Benefits:
- Competitive salary and equity
- Health insurance and 401k
- Remote work opportunities
- Professional development budget
"""

# Extract keywords from the job posting
keywords = analyze_job_posting(job_description)

print("Job Posting Analysis")
print("=" * 50)
print(f"Extracted {len(keywords)} ranked keywords")
print("\nTop 10 keywords:")
for i, kw in enumerate(keywords[:10], 1):
    print(f"{i}. {kw['text']:30} (score: {kw['score']:.3f}, section: {kw['section']})")


# Example 2: Create a sample resume (in production, load from database)
# =====================================================================
from datetime import datetime, timezone

profile = Profile(
    id='resume-123',
    first_name='Jane',
    last_name='Smith',
    email='jane@example.com',
    phone='(555) 123-4567',
    linkedin_url='https://linkedin.com/in/janesmith',
    location='San Francisco, CA',
    work_auth=None,
    created_at=datetime.now(tz=timezone.utc),
    updated_at=datetime.now(tz=timezone.utc),
)

experiences = [
    ProfileExperience(
        id=1,
        profile_id='resume-123',
        company='TechCorp',
        title='Senior Backend Engineer',
        location='San Francisco',
        start_date='2020-01',
        end_date=None,
        is_current=True,
        description="""
            Led design and implementation of microservices architecture using Python and FastAPI.
            Optimized PostgreSQL queries reducing response time by 40%.
            Mentored team of 3 junior developers.
            Deployed services using Docker and Kubernetes on AWS.
        """,
        display_order=0,
    ),
    ProfileExperience(
        id=2,
        profile_id='resume-123',
        company='StartupXYZ',
        title='Full-Stack Engineer',
        location='Remote',
        start_date='2018-06',
        end_date='2019-12',
        is_current=False,
        description="""
            Built full-stack web application with React frontend and Python backend.
            Designed REST APIs and implemented authentication using JWT.
            Set up CI/CD pipeline with GitHub Actions.
        """,
        display_order=1,
    ),
]

educations = [
    ProfileEducation(
        id=1,
        profile_id='resume-123',
        institution='Stanford University',
        degree='BS',
        major='Computer Science',
        gpa='3.7',
        grad_year='2018',
        display_order=0,
    ),
]


# Example 3: Score the resume against the job
# ============================================
print("\n\nResume-to-Job Fit Analysis")
print("=" * 50)

results = compute_resume_fit_score(
    profile=profile,
    experiences=experiences,
    educations=educations,
    job_keywords=keywords,
    transformer=transformer,
    semantic_threshold=0.75,  # Tune this value (0-1, higher = stricter)
)

print(f"\nOverall Fit Score: {results['overall_score']:.2%}")
print(f"Matched Keywords: {results['match_count']}/{results['total_keywords']}")

print("\nFit Score by Job Section:")
for section, score in results['section_scores'].items():
    bar = "█" * int(score * 20) + "░" * (20 - int(score * 20))
    print(f"  {section:20} {bar} {score:.0%}")

print("\nTop 10 Matched Keywords:")
for i, match in enumerate(results['matched_keywords'][:10], 1):
    print(
        f"{i:2}. {match['keyword']:25} "
        f"({match['match_type']:10}) "
        f"importance:{match['keyword_importance']:.2f}"
    )

# Unmatched keywords (gaps in resume)
unmatched = [
    kw for kw in keywords
    if kw['text'] not in [m['keyword'] for m in results['matched_keywords']]
]
print(f"\nUnmatched Keywords ({len(unmatched)} gaps):")
for i, kw in enumerate(unmatched[:5], 1):
    print(f"{i}. {kw['text']:25} (importance: {kw['score']:.2f}, section: {kw['section']})")
