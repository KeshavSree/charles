from sentence_transformers import util
from storage.models import Profile, ProfileExperience, ProfileEducation


def resume_to_text(
    profile: 'Profile',
    experiences: list['ProfileExperience'],
    educations: list['ProfileEducation'],
) -> str:
    parts = []

    # contact information section
    if profile.first_name or profile.last_name:
        parts.append(f'{profile.first_name} {profile.last_name}'.strip())

    if profile.email:
        parts.append(profile.email)

    if profile.phone:
        parts.append(profile.phone)

    if profile.linkedin_url:
        parts.append(profile.linkedin_url)

    if profile.location:
        parts.append(profile.location)

    # experience section
    if experiences:
        parts.append('Experience')

        for exp in experiences:
            if exp.title:
                parts.append(f'{exp.title}')

            if exp.company:
                parts.append(f'at {exp.company}')

            if exp.location:
                parts.append(f'in {exp.location}')

            if exp.start_date or exp.end_date:
                dates = f'{exp.start_date or ''} - {exp.end_date or 'Present'}'.strip()

                if dates:
                    parts.append(dates)

            if exp.description:
                parts.append(exp.description)

    # education section
    if educations:
        parts.append('Education')

        for edu in educations:
            if edu.institution:
                parts.append(edu.institution)

            if edu.degree:
                parts.append(edu.degree)

            if edu.major:
                parts.append(edu.major)

            if edu.gpa:
                parts.append(f'GPA: {edu.gpa}')

            if edu.grad_year:
                parts.append(f'Graduated: {edu.grad_year}')

    return '\n'.join(parts)


def resume_to_sections(
    profile: 'Profile',
    experiences: list['ProfileExperience'],
    educations: list['ProfileEducation'],
) -> dict[str, str]:
    sections = {}

    # contact information section
    contact_parts = []

    if profile.first_name or profile.last_name:
        contact_parts.append(f'{profile.first_name} {profile.last_name}'.strip())

    if profile.email:
        contact_parts.append(profile.email)

    if profile.phone:
        contact_parts.append(profile.phone)

    if profile.linkedin_url:
        contact_parts.append(profile.linkedin_url)

    if profile.location:
        contact_parts.append(profile.location)

    if contact_parts:
        sections['contact'] = '\n'.join(contact_parts)

    # experience section
    exp_parts = []

    for exp in experiences:
        exp_text = []

        if exp.title:
            exp_text.append(f'{exp.title}')

        if exp.company:
            exp_text.append(f'at {exp.company}')

        if exp.location:
            exp_text.append(f'in {exp.location}')

        if exp.start_date or exp.end_date:
            dates = f'{exp.start_date or ''} - {exp.end_date or 'Present'}'.strip()

            if dates:
                exp_text.append(dates)

        if exp.description:
            exp_text.append(exp.description)

        if exp_text:
            exp_parts.append('\n'.join(exp_text))

    if exp_parts:
        sections['experience'] = '\n'.join(exp_parts)

    # education section
    edu_parts = []

    for edu in educations:
        edu_text = []

        if edu.institution:
            edu_text.append(edu.institution)

        if edu.degree:
            edu_text.append(edu.degree)

        if edu.major:
            edu_text.append(edu.major)

        if edu.gpa:
            edu_text.append(f'GPA: {edu.gpa}')

        if edu.grad_year:
            edu_text.append(f'Graduated: {edu.grad_year}')

        if edu_text:
            edu_parts.append('\n'.join(edu_text))

    if edu_parts:
        sections['education'] = '\n'.join(edu_parts)

    return sections


def match_resume_to_keywords(
    resume_text: str,
    job_keywords: list[dict],
    transformer,
    semantic_threshold: float = 0.75,
) -> dict:
    resume_lower = resume_text.lower()

    matched_items = []
    section_keyword_count = {}
    section_match_count = {}

    for kw in job_keywords:
        keyword_text = kw['text'].lower()
        section = kw.get('section', 'unknown')

        # track keyword counts by section
        if section not in section_keyword_count:
            section_keyword_count[section] = 0
            section_match_count[section] = 0

        section_keyword_count[section] += 1

        # exact match (case-insensitive)
        if keyword_text in resume_lower:
            matched_items.append({
                'keyword': kw['text'],
                'match_type': 'exact',
                'keyword_importance': kw['score'],
                'match_score': 1.0,
                'section': section,
            })

            section_match_count[section] += 1
            continue

        # semantic match using transformer
        try:
            kw_embedding = transformer.encode(kw['text'], convert_to_tensor=True)
            resume_embedding = transformer.encode(resume_text, convert_to_tensor=True)
            similarity = util.cos_sim(kw_embedding, resume_embedding).item()

            if similarity >= semantic_threshold:
                matched_items.append({
                    'keyword': kw['text'],
                    'match_type': 'semantic',
                    'keyword_importance': kw['score'],
                    'match_score': similarity,
                    'section': section,
                })

                section_match_count[section] += 1
        except Exception:
            pass

    # calculate section scores
    section_scores = {}
    
    for section in section_keyword_count:
        total = section_keyword_count[section]
        matched = section_match_count[section]
        section_scores[section] = matched / total if total > 0 else 0.0

    # calculate overall score: weighted by keyword importance
    total_importance = sum(kw['score'] for kw in job_keywords)
    matched_importance = sum(m['keyword_importance'] for m in matched_items)
    overall_score = (matched_importance / total_importance) if total_importance > 0 else 0.0

    # sort matched items by importance
    matched_items.sort(key=lambda x: x['keyword_importance'], reverse=True)

    return {
        'overall_score': min(overall_score, 1.0),
        'match_count': len(matched_items),
        'total_keywords': len(job_keywords),
        'matched_keywords': matched_items,
        'section_scores': section_scores,
    }


def compute_resume_fit_score(
    profile: 'Profile',
    experiences: list['ProfileExperience'],
    educations: list['ProfileEducation'],
    job_keywords: list[dict],
    transformer,
    semantic_threshold: float = 0.75,
) -> dict:
    resume_text = resume_to_text(profile, experiences, educations)
    
    return match_resume_to_keywords(resume_text, job_keywords, transformer, semantic_threshold)
