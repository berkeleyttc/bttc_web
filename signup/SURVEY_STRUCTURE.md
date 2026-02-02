# Rating Survey Structure

## Overview
The rating survey helps assess new players' skill levels across 5 core dimensions plus 4 optional advanced skills.

## Survey Format

### Required Questions (A-E)
Each question has 4 progressive levels (0-3), from beginner to advanced.

---

### A. Playing Experience & Results
**Purpose:** Gauge competitive experience level

- **A0** - Casual only (no club/league experience)
- **A1** - Occasional club play (informal)
- **A2** - Regular club/league (competitive)
- **A3** - Frequent tournaments (top performers)

---

### B. Rally & Consistency
**Purpose:** Measure ball control and rally ability

- **B0** - Struggles with basic rallies
- **B1** - Can rally at controlled pace (non-attacking)
- **B2** - Reliable rallies, directional changes, 10+ ball drills
- **B3** - High-speed rallies with counters/blocks

---

### C. Spin & Serves
**Purpose:** Assess serve variety and spin generation

- **C0** - Mostly flat serves, no spin control
- **C1** - Basic topspin/backspin serves
- **C2** - Varied spinny serves (short/long, different placements)
- **C3** - Advanced serves with disguise (pendulum, reverse, hook)

---

### D. Receive, Spin Handling & Tactics
**Purpose:** Evaluate spin reading and tactical awareness

- **D0** - Struggles with spin (many errors)
- **D1** - Can return simple spin, heavy spin causes errors
- **D2** - Reads most spins, chooses safe/aggressive returns
- **D3** - Reads complex spin, varies receives, uses tactics

---

### E. Footwork & Match Play
**Purpose:** Assess movement quality and positioning

- **E0** - Stands in place, often out of position
- **E1** - Some movement, trouble recovering
- **E2** - Good side-to-side, distance adjustment, multi-ball
- **E3** - Anticipates well, efficient movement, maintains position

---

## Optional Skills (F-I)
Check all that apply (can select multiple or none).

- **F** - Loop forehand against strong backspin (consistently)
- **G** - Loop backhand against strong backspin (consistently)
- **H** - Counter-loop away from table (against topspin)
- **I** - Chop defensively (mid/far distance with backspin)

---

## Data Structure

### Frontend Collection
```javascript
{
  a: "A2",      // string: A0, A1, A2, or A3
  b: "B1",      // string: B0, B1, B2, or B3
  c: "C2",      // string: C0, C1, C2, or C3
  d: "D1",      // string: D0, D1, D2, or D3
  e: "E2",      // string: E0, E1, E2, or E3
  f: true,      // boolean: can loop FH backspin
  g: false,     // boolean: can loop BH backspin
  h: false,     // boolean: can counter-loop
  i: false      // boolean: can chop
}
```

### API Payload
```json
{
  "first_name": "Jane",
  "last_name": "Smith",
  "phone_number": "5559876543",
  "email": "jane@example.com",
  "rating_survey": {
    "a": "A2",
    "b": "B1",
    "c": "C2",
    "d": "D1",
    "e": "E2",
    "f": true,
    "g": false,
    "h": false,
    "i": false
  }
}
```

---

## Backend Processing Suggestions

### Option 1: Point-Based System
```
Base Points:
- A0=0, A1=1, A2=2, A3=3
- B0=0, B1=1, B2=2, B3=3
- C0=0, C1=1, C2=2, C3=3
- D0=0, D1=1, D2=2, D3=3
- E0=0, E1=1, E2=2, E3=3

Bonus Points:
- F=0.5, G=0.5, H=0.5, I=0.5

Total Score: 0-17 points
```

### Option 2: Weighted System
```
Different weights per category:
- Experience (A): 20%
- Rally (B): 25%
- Spin (C): 20%
- Tactics (D): 20%
- Footwork (E): 15%
- Optional (F-I): Bonus modifiers
```

### Option 3: Profile-Based
```
Create skill profiles:
- Beginner: Mostly 0s and 1s
- Intermediate: Mix of 1s and 2s
- Advanced: Mostly 2s and 3s
- Expert: Mostly 3s + optional skills
```

---

## UI/UX Features

### Visual Design
- **Required questions (A-E)**: Gray background, blue when selected
- **Optional questions (F-I)**: Yellow background, highlight when checked
- **Radio buttons**: Single selection per question
- **Checkboxes**: Multiple selections allowed
- **Hover effects**: Border highlights on hover
- **Mobile optimized**: Touch-friendly sizing

### Validation
- All A-E questions must be answered before submission
- F-I questions are truly optional (can skip all or select any)
- Clear error message if required questions missing

### Progress
- Step indicator shows: "1. Basic Info" → "2. Skill Survey"
- Back button preserves all entered data
- Smooth scroll to top on step transitions

---

## Future Enhancements

1. **Helper Text/Tooltips**
   - Add "?" icons with detailed explanations
   - Video demonstrations for each skill level

2. **Confidence Level**
   - Add "Not sure" option for uncertain players
   - Save confidence rating with response

3. **Retake Survey**
   - Allow players to update survey as they improve
   - Track progression over time
   - Show rating history chart

4. **Admin Override**
   - Allow staff to adjust calculated rating
   - Add notes explaining adjustments
   - Flag suspicious responses

5. **Analytics Dashboard**
   - Show distribution of responses
   - Identify rating trends
   - Compare self-assessment vs actual performance
