import re, spacy

from keybert import KeyBERT
from spacy.matcher import PhraseMatcher
from sentence_transformers import SentenceTransformer, util

from tfidf import TfidfScorer

# torch installed as dependency for sentence-transformers with full
# CUDA/GPU support; monitor and switch to CPU-only version if needed


# TODO: replace with more comprehensive list (or use better model)
SECTION_PATTERNS = {
    "required": ["required", "must have", "minimum qualifications", "you have"],
    "preferred": ["preferred", "nice to have", "bonus", "plus if you"],
    "responsibilities": ["responsibilities", "you will", "what you'll do", "duties"],
    "benefits": ["benefits", "we offer", "perks", "compensation"],
    "about": ["about us", "who we are", "our mission"],
}

# initial list; modify as needed
NER_LABELS = {'ORG', 'PRODUCT', 'GPE', 'WORK_OF_ART', 'EVENT'}

EXP_PATTERN = re.compile(
    r'(\d+)\+?\s*(?:to\s*\d+)?\s*years?\s+(?:of\s+)?([a-zA-Z\s]+?)(?:experience|exp)',
    re.I
)

SECTION_WEIGHTS = {
    'required': 1.0,
    'responsibilities': 0.7,
    'preferred': 0.5,
    'benefits': 0.1,
    'about': 0.1,
    'unknown': 0.4
}


# initialize models
nlp = spacy.load('en_core_web_lg')

# TODO: replace with more complete list (i.e. esco, linkedin skill taxonomy)
skills = ['Python', 'Java', 'C++', 'JavaScript', 'SQL', 'HTML', 'CSS',
          'React', 'Node.js', 'Django', 'Flask', 'Ruby on Rails', 'Angular',
          'Vue.js', 'Swift', 'Kotlin', 'PHP', 'TypeScript', 'Go', 'Rust']
patterns = [nlp.make_doc(s) for s in skills]

matcher = PhraseMatcher(nlp.vocab, attr='LOWER')
matcher.add("SKILL", patterns)

kw_model = KeyBERT(model='all-MiniLM-L6-v2')
transformer = SentenceTransformer('all-MiniLM-L6-v2')

# TODO: replace with more comprehensive corpus
corpus = ['hello world']

tfidf_scorer = TfidfScorer()
tfidf_scorer.fit(corpus)


def preprocess_text(raw_text: str) -> str:
    # remove html tags
    text = re.sub(r'<[^>]+>', ' ', raw_text)

    # normalize whitespace characters
    text = re.sub(r'\s+', ' ', text)

    # normalize bullet point characters
    # \u2022 = bullet, \u00B7 = middle dot, \u25AA = black small square,
    # \u25E6 = white bullet, \u25CF = black circle, \u2013 = en dash,
    # \u2014 = em dash, \u2023 = triangular bullet,
    # \u25B8 = black right-pointing small triangle, \u2043 = hyphen bullet
    text = re.sub(r'[\u2022\u00B7\u25AA\u25E6\u25CF\u2013\u2014\u2023\u25B8\u2043]', '\n-', text)

    # replace smart quotes
    # \u2018 = left single quotation mark, \u2019 = right single quotation mark
    text = re.sub(r'\u2018|\u2019', '\'', text)

    # \u201C = left double quotation mark, \u201D = right double quotation mark
    text = re.sub(r'\u201C|\u201D', '"', text)

    return text.strip()


def detect_section(line: str) -> str:
    line_lower = line.lower()

    for section, patterns in SECTION_PATTERNS.items():
        if any(p in line_lower for p in patterns):
            return section
        
    return 'unknown'


def extract_entities(text: str, section_label: str) -> list[dict]:
    doc = nlp(text)
    entities = []

    # using spaCy's default name entity recognition tool
    # catch generic entities (company names, products, locations)
    for ent in doc.ents:
        if ent.label_ in NER_LABELS:
            entities.append({
                'text': ent.text,
                'section': section_label,
                'type': 'ner_entity',
                'ner_label': ent.label_,
                'experience_required': None,
                'start': ent.start,
                'end': ent.end
            })

    # using PhraseMatcher with the list of skills as defined above
    # catch more field-specific entities (programming languages, frameworks)
    for _, start, end in matcher(doc):
        entities.append({
            'text': doc[start:end].text,
            'section': section_label,
            'type': 'skill',
            'ner_label': None,
            'experience_required': None,
            'start': start,
            'end': end
        })

    # using plain regex as defined above
    # catch experience requirements (# of years)
    for match in EXP_PATTERN.finditer(text):
        years = match.group(1)
        context = match.group(2).strip()

        entities.append({
            'text': context,
            'section': section_label,
            'type': 'experience_requirement',
            'ner_label': None,
            'experience_required': int(years),
            # start/end values are character offsets, not token indices
            'start': match.start(),
            'end': match.end()
        })

    return entities


def rank_keywords(text: str, entities: list[dict]) -> list[dict]:
    keywords = kw_model.extract_keywords(
        text,
        keyphrase_ngram_range=(1, 3),
        stop_words='english',
        top_n=30
    )

    scores = {keyword: score for keyword, score in keywords}
    ranked = []

    for entity in entities:
        section_score = SECTION_WEIGHTS.get(entity['section'], 0.4)
        keybert_score = scores.get(entity['text'], 0.1)
        tfidf_score = tfidf_scorer.score(text, entity['text'])

        final_score = (0.4 * section_score) + (0.35 * keybert_score) + (0.25 * tfidf_score)
        ranked.append({**entity, 'score': final_score})

    return sorted(ranked, key=lambda x: x['score'], reverse=True)


def cluster_keywords(keywords: list[dict], threshold: float=0.82) -> list[dict]:
    texts = [kw['text'] for kw in keywords]
    embeddings = transformer.encode(texts, convert_to_tensor=True)

    clusters = []
    used = set()

    for i, kw in enumerate(keywords):
        if i in used:
            continue

        cluster = [kw]

        for j in range(i + 1, len(keywords)):
            if j not in used:
                sim = util.cos_sim(embeddings[i], embeddings[j]).item()

                if sim >= threshold:
                    cluster.append(keywords[j])
                    used.add(j)

        canonical = max(cluster, key=lambda x: x['score'])
        canonical['score'] = sum(kw['score'] for kw in cluster) / len(cluster) # pure sum or average?
        canonical['aliases'] = [kw['text'] for kw in cluster if kw != canonical]

        clusters.append(canonical)
        used.add(i)

    return sorted(clusters, key=lambda x: x['score'], reverse=True)