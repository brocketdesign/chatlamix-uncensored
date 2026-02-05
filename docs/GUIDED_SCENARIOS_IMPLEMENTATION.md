# Guided Scenarios Implementation

## Overview

This document describes the implementation of **Predefined Guided Scenarios** - a feature that provides users with immersive, goal-oriented conversation experiences. Unlike traditional AI-generated scenarios, these pre-built scenarios load instantly and include structured progress tracking through thresholds/milestones.

## Problem Statement

The original AI-generated scenarios had several limitations:
- **Slow loading times** - AI generation could take 3-10 seconds
- **Inconsistent quality** - Generated scenarios varied in engagement
- **No progress tracking** - Users had no visibility into conversation progression
- **No clear goals** - Conversations felt directionless

## Solution Architecture

### Core Components

```
┌─────────────────────────────────────────────────────────────────────┐
│                     GUIDED SCENARIOS SYSTEM                         │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌──────────────────┐    ┌──────────────────┐    ┌───────────────┐ │
│  │   Predefined     │    │   Scenario API   │    │   Frontend    │ │
│  │   Scenarios      │───▶│   Routes         │───▶│   Module      │ │
│  │   (11 total)     │    │                  │    │               │ │
│  └──────────────────┘    └──────────────────┘    └───────────────┘ │
│         │                        │                       │         │
│         │                        ▼                       │         │
│         │               ┌──────────────────┐             │         │
│         └──────────────▶│  MongoDB Storage │◀────────────┘         │
│                         │  (userChat)      │                       │
│                         └──────────────────┘                       │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 1. Predefined Scenarios (`models/predefined-scenarios.js`)

### Scenario Structure

Each predefined scenario includes:

```javascript
{
    id: 'lost-in-woods',                    // Unique identifier
    title: '❄️ Lost in the Freezing Woods', // Display title with emoji
    description: 'Brief scenario description...',
    category: 'emotional',                   // Category type
    initialSituation: 'The starting context...',
    goal: 'Help them survive the cold and earn their trust',
    thresholds: [                           // 5 milestones (0-100%)
        { id: 1, name: 'First Contact', description: '...', progress: 20 },
        { id: 2, name: 'Provide Comfort', description: '...', progress: 40 },
        { id: 3, name: 'Build Trust', description: '...', progress: 60 },
        { id: 4, name: 'Deep Connection', description: '...', progress: 80 },
        { id: 5, name: 'Safe Haven', description: '...', progress: 100 }
    ],
    finalQuote: '"Thank you for not leaving me..."',
    emotionalTone: 'Vulnerable, grateful, intimate',
    conversationDirection: 'How the conversation should flow',
    isPremiumOnly: false,                   // Premium gate
    isAlertOriented: false,                 // Alert/urgent flag
    icon: '❄️'                              // Display icon
}
```

### Scenario Categories

| Category | Description | Example Scenarios |
|----------|-------------|-------------------|
| `emotional` | Deep emotional journeys | Lost in Woods, Last Chance |
| `romantic` | Romance-focused stories | Midnight Confession, Rainy Day Shelter |
| `supportive` | Comfort and healing | Picking Up the Pieces |
| `mystery` | Discovery and revelation | Secret Admirer Revealed |
| `alert` | Urgent/crisis situations (Premium) | The 3 AM Call, Emergency Shelter |

### Available Scenarios

#### Free Scenarios (6)
| Icon | Title | Goal |
|------|-------|------|
| ❄️ | Lost in the Freezing Woods | Help them survive the cold and earn their trust |
| 🌙 | Midnight Confession | Discover their secret and respond with understanding |
| 🌧️ | Rainy Day Shelter | Turn an awkward situation into a memorable connection |
| 💔 | Picking Up the Pieces | Help them heal and show them they're not alone |
| 💌 | Secret Admirer Revealed | Discover why they kept their feelings secret |
| 🔥 | Rekindling Old Flames | Navigate the past and decide if there's a future |

#### Premium Scenarios (5)
| Icon | Title | Alert | Goal |
|------|-------|-------|------|
| 📞 | The 3 AM Call | ✅ | Be their anchor during a vulnerable moment |
| 🚨 | Emergency Shelter | ✅ | Protect them and provide safety during a crisis |
| 🔒 | The Dangerous Secret | ✅ | Help them decide what to do while keeping them safe |
| 🗝️ | Forbidden Meeting | ❌ | Share a forbidden moment and decide if it's worth it |
| ⏰ | Last Chance | ❌ | Say everything that needs to be said before it's too late |

### Key Functions

```javascript
// Get scenarios filtered by premium status
getFilteredScenarios(isPremium)

// Get random selection of scenarios
getRandomScenarios(isPremium, count = 3)

// Personalize scenario with character name
personalizeScenario(scenario, characterName)

// Get prepared scenarios for fast loading
getPreparedScenarios(charInfo, isPremium, count = 3)

// Get specific scenario by ID
getScenarioById(scenarioId, characterName, isPremium)
```

---

## 2. Backend API (`routes/chat-scenario-api.js`)

### Endpoints

#### `GET /api/chat-scenarios/:userChatId`
Fetches current scenario data for a chat.

**Response:**
```javascript
{
    currentScenario: { ... } | null,
    availableScenarios: [...],
    scenarioCreatedAt: Date,
    scenarioProgress: 0-100
}
```

#### `POST /api/chat-scenarios/:userChatId/generate`
Generates new scenarios (uses predefined scenarios by default).

**Request Body:**
```javascript
{
    useAI: false  // Optional: set true to use AI generation instead
}
```

**Response:**
```javascript
{
    success: true,
    scenarios: [...],
    isPremium: boolean
}
```

#### `POST /api/chat-scenarios/:userChatId/select`
Selects a scenario and starts the conversation.

**Request Body:**
```javascript
{
    scenarioId: 'lost-in-woods'
}
```

**Response:**
```javascript
{
    success: true,
    scenario: { ... },
    shouldStartConversation: true,
    autoGenerateResponse: true,
    updatedMessages: [...]
}
```

#### `GET /api/chat-scenarios/:userChatId/progress`
Gets current scenario progress and threshold information.

**Response:**
```javascript
{
    success: true,
    progress: 40,
    currentThreshold: { id: 2, name: 'Provide Comfort', progress: 40 },
    nextThreshold: { id: 3, name: 'Build Trust', progress: 60 },
    goalAchieved: false,
    finalQuote: null
}
```

#### `POST /api/chat-scenarios/:userChatId/progress`
Updates scenario progress manually.

**Request Body:**
```javascript
{
    progress: 60  // 0-100
}
```

**Response:**
```javascript
{
    success: true,
    progress: 60,
    goalAchieved: false,
    finalQuote: null
}
```

---

## 3. Progress Tracking System

### How Progress is Stored

Progress is stored in the `userChat` MongoDB collection:

```javascript
{
    _id: ObjectId,
    userId: ObjectId,
    chatId: ObjectId,
    currentScenario: { ... },           // Currently active scenario
    availableScenarios: [...],          // Scenarios not yet selected
    scenarioProgress: 0-100,            // Current progress percentage
    scenarioGenerated: boolean,         // Flag to prevent regeneration
    messages: [...]                     // Chat messages
}
```

### Automatic Progress Evaluation (AI-Powered)

The system **automatically evaluates scenario progress** after each chat completion using **GPT-4o-mini** for intelligent conversation analysis. This happens in `routes/chat-completion-api.js` and uses the `evaluateScenarioProgress` function from `models/chat-scenario-utils.js`, which internally calls `evaluateScenarioProgressAI` from `models/openai.js`.

#### Why AI-Powered Evaluation?

Unlike simple keyword matching, AI-powered evaluation:
- **Understands context** - Recognizes emotional moments even without specific keywords
- **Detects nuance** - Identifies when thresholds are achieved through implied meaning
- **Adapts to conversation style** - Works regardless of how users phrase their responses
- **Provides confidence scores** - Indicates how certain the evaluation is

#### Evaluation Flow

```
┌─────────────────────────────────────────────────────────────────────┐
│               AI-POWERED PROGRESS EVALUATION FLOW                   │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  1. User sends message                                              │
│         ↓                                                           │
│  2. AI generates response (main chat completion)                    │
│         ↓                                                           │
│  3. Response saved to database                                      │
│         ↓                                                           │
│  4. Check if scenario is active                                     │
│         ↓                                                           │
│  5. evaluateScenarioProgress() called                               │
│         ↓                                                           │
│  6. evaluateScenarioProgressAI() invoked                            │
│         ├── Build scenario context (goal, thresholds)               │
│         ├── Format conversation (last 10 messages)                  │
│         └── Call GPT-4o-mini with structured output                 │
│         ↓                                                           │
│  7. Parse AI response with Zod schema validation                    │
│         ├── progress: 0-100                                         │
│         ├── thresholds_achieved: [ids]                              │
│         ├── current_threshold_id: number                            │
│         ├── emotional_alignment: 0-100                              │
│         ├── goal_proximity: 0-100                                   │
│         ├── confidence: 0-100                                       │
│         └── reasoning: string                                       │
│         ↓                                                           │
│  8. Ensure progress never decreases (compare with stored)           │
│         ↓                                                           │
│  9. Update database if progress increased                           │
│         ↓                                                           │
│  10. Send WebSocket notification to frontend                        │
│         ↓                                                           │
│  11. Frontend updates progress bar UI                               │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

#### AI Evaluation Prompt Structure

The AI receives structured information about:

1. **Scenario Context**
   - Goal to achieve
   - All thresholds with descriptions and progress values
   - Expected emotional tone

2. **Conversation History**
   - Last 10 messages (to prevent token overflow)
   - User and assistant messages only (no system prompts)

3. **Evaluation Criteria**
   - Which thresholds have been achieved
   - How close the conversation is to the goal
   - How well the emotional tone matches
   - Confidence level in the evaluation

#### AI Response Schema (Zod Validated)

```javascript
const scenarioProgressSchema = z.object({
    progress: z.number().min(0).max(100)
        .describe('Overall progress percentage from 0-100'),
    thresholds_achieved: z.array(z.number())
        .describe('Array of threshold IDs that have been achieved'),
    current_threshold_id: z.number().nullable()
        .describe('ID of the current active threshold'),
    emotional_alignment: z.number().min(0).max(100)
        .describe('How well the conversation matches the expected emotional tone'),
    goal_proximity: z.number().min(0).max(100)
        .describe('How close the conversation is to achieving the goal'),
    confidence: z.number().min(0).max(100)
        .describe('Confidence level in this evaluation'),
    reasoning: z.string()
        .describe('Brief explanation of the progress evaluation')
});
```

#### Example AI Evaluation

**Input Scenario:** "Lost in the Freezing Woods"
- Goal: Help them survive the cold and earn their trust

**Conversation Excerpt:**
```
User: "You must be freezing out there. Come inside, I'll get you a blanket."
Character: "*shivers* T-thank you... I didn't think anyone would find me..."
User: "You're safe now. Here, wrap this around you. What happened?"
```

**AI Evaluation Response:**
```javascript
{
    progress: 45,
    thresholds_achieved: [1, 2],  // First Contact, Provide Comfort
    current_threshold_id: 2,
    emotional_alignment: 78,      // Good vulnerable/grateful tone
    goal_proximity: 45,
    confidence: 85,
    reasoning: "User has made first contact and provided physical comfort (blanket, shelter). Building towards trust as user asks about what happened."
}
```

### Progress Validation Rules

1. **Progress can only increase** - AI evaluation is compared with stored progress, and the higher value is kept
2. **Maximum 100%** - Capped at goal achievement
3. **Minimum 0%** - Cannot go negative
4. **Graceful fallback** - If AI evaluation fails, returns current progress with no update

### WebSocket Notifications

When progress changes, the server sends WebSocket events to the frontend. These events are handled in `public/js/websocket.js` which routes them to the `ChatScenarioModule`.

#### `scenarioProgressUpdated` Event
```javascript
{
    progress: 60,
    previousProgress: 40,
    currentThreshold: { id: 3, name: 'Build Trust', progress: 60 },
    nextThreshold: { id: 4, name: 'Deep Connection', progress: 80 },
    goalAchieved: false,
    finalQuote: null,
    userChatId: '...'
}
```

#### `scenarioGoalAchieved` Event
```javascript
{
    finalQuote: '"Thank you for saving me..."',
    scenarioTitle: '❄️ Lost in the Freezing Woods',
    userChatId: '...'
}
```

### Manual Progress Update API

In addition to automatic evaluation, progress can be manually updated:

#### `POST /api/chat-scenarios/:userChatId/progress`

**Request Body:**
```javascript
{
    progress: 60  // 0-100
}
```

**Response:**
```javascript
{
    success: true,
    progress: 60,
    goalAchieved: false,
    finalQuote: null
}
```

---

## 4. Frontend Module (`public/js/chat-scenario.js`)

### Key Functions

```javascript
// Initialize with chat IDs
ChatScenarioModule.init(chatId, userChatId)

// Generate new scenarios
ChatScenarioModule.generateScenarios()

// Display scenario cards
ChatScenarioModule.displayScenarios()

// Select a scenario
ChatScenarioModule.selectScenario(scenarioId)

// Update progress bar
ChatScenarioModule.updateProgressBar(progress)

// Display goal achieved celebration
ChatScenarioModule.displayGoalAchieved(finalQuote)
```

### UI Components

#### Scenario Cards
- Emoji icon for visual identification
- Premium (⭐) and Alert (🚨) badges
- Goal preview with 🎯 icon
- Threshold preview (first 2 milestones)
- Emotional tone display
- "Start This Adventure" button

#### Selected Scenario Display
- Header with icon and title
- Goal section with clear objective
- Initial situation description
- Progress bar with milestone markers
- Emotional tone metadata

#### Progress Bar
- Visual progress indicator (0-100%)
- Threshold markers at each milestone position
- Achieved markers turn gold/highlighted
- Smooth animation on updates

#### Goal Achieved Celebration
- 🎉 Celebration icon
- "Goal Achieved!" title
- Final quote display in blockquote
- Congratulations message

---

## 5. Styling (`public/css/chat-scenario.css`)

### Design System

```css
/* Color Variables */
--scenario-primary: #6E20F4;      /* Purple primary */
--scenario-premium: #FFD700;       /* Gold for premium */
--scenario-alert: #FF4444;         /* Red for alerts */
--scenario-success: #28a745;       /* Green for achievements */
--scenario-bg: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
```

### Card Animations

- **Hover**: Card lifts 4px with enhanced shadow
- **Premium badge**: Subtle pulse animation
- **Alert badge**: Stronger pulse animation
- **Progress bar**: Smooth width transition
- **Threshold achieved**: Fade-in with scale effect

---

## 6. Security Considerations

### Premium Validation
- Alert-oriented scenarios require premium subscription
- Subscription status checked server-side before scenario access
- Premium flag cannot be spoofed from frontend

### Content Escaping
- All user-facing content is HTML-escaped using `escapeHtml()`
- Prevents XSS attacks in scenario titles, descriptions, and quotes

### Access Control
- All API endpoints verify `userId` matches `userChatId` ownership
- Prevents accessing other users' scenarios or progress

---

## 7. Database Schema

### userChat Collection Updates

```javascript
{
    // Existing fields...
    
    // New scenario fields
    currentScenario: {
        _id: String,
        scenario_title: String,
        scenario_description: String,
        initial_situation: String,
        goal: String,
        thresholds: Array,
        final_quote: String,
        emotional_tone: String,
        conversation_direction: String,
        is_premium_only: Boolean,
        is_alert_oriented: Boolean,
        icon: String,
        category: String,
        system_prompt_addition: String
    },
    availableScenarios: Array,
    scenarioProgress: Number,           // 0-100
    scenarioGenerated: Boolean,
    scenarioCreatedAt: Date,
    scenarioHistory: Array              // Past scenarios with metadata
}
```

---

## 8. Localization

### Translation Keys

Located in `locales/chat-scenarios-{lang}.json`:

```json
{
    "scenarios_loading": "Generating scenarios...",
    "no_scenarios_available": "No scenarios available",
    "emotional_tone": "Tone",
    "choose_scenario": "Start This Adventure",
    "selected": "Selected",
    "scenario_selected": "Scenario selected!",
    "goal": "Your Goal",
    "thresholds": "Milestones",
    "progress": "Progress",
    "goal_achieved": "Goal Achieved!",
    "congratulations": "Congratulations! You've completed this scenario."
}
```

### Supported Languages
- English (en)
- Japanese (ja)
- French (fr)

---

## 9. Testing

### Debug Console Commands

```javascript
// Show loading spinner
ScenarioDebug.showSpinner()

// Hide spinner
ScenarioDebug.hideSpinner()

// Show placeholder scenarios
ScenarioDebug.showScenarioPlaceholder()

// Test responsive design
ScenarioDebug.testResponsive()

// Show help
ScenarioDebug.help()
```

### Manual Testing Checklist

- [ ] Scenario cards display correctly
- [ ] Premium/Alert badges show for appropriate scenarios
- [ ] Progress bar updates smoothly
- [ ] Threshold markers highlight when achieved
- [ ] Goal achieved celebration displays correctly
- [ ] Swiper carousel navigation works
- [ ] Mobile responsive layout works
- [ ] Premium users can access alert scenarios
- [ ] Free users cannot access premium scenarios

---

## 10. Future Improvements

### Planned Enhancements

1. **Branching Scenarios**
   - Multiple paths based on user choices
   - Different endings based on progress path

2. **Scenario Achievements**
   - Unlock badges for completing scenarios
   - Track scenario completion history

3. **Custom Scenarios**
   - Allow premium users to create custom scenarios
   - Community scenario sharing

4. **Scenario Recommendations**
   - Suggest scenarios based on user preferences
   - Learn from completed scenarios

5. **Enhanced AI Evaluation**
   - Fine-tuned models for scenario-specific evaluation
   - Multi-language progress detection improvements

---

## 11. Troubleshooting

### Common Issues

| Issue | Cause | Solution |
|-------|-------|----------|
| Scenarios not loading | Network error | Check API connectivity |
| Progress not updating | Missing userChatId | Verify chat initialization |
| Premium scenarios showing for free users | Cache issue | Clear browser cache |
| Swiper not working | JS not loaded | Check for Swiper library |

### Logging

Enable debug logging:
```javascript
localStorage.setItem('scenarioDebug', 'true');
```

View logs in browser console:
```
[ChatScenarioModule] ...
[ScenarioDebug] ...
```

---

## Summary

The Guided Scenarios system provides:
- ✅ **11 pre-built scenarios** (6 free, 5 premium)
- ✅ **Instant loading** (no AI generation delay)
- ✅ **Clear goals** with 5 thresholds each
- ✅ **Visual progress tracking** with milestone markers
- ✅ **Premium content gating** for monetization
- ✅ **Alert scenarios** for urgent/crisis roleplay
- ✅ **Celebration on completion** with memorable quotes
- ✅ **Full localization** (EN, JA, FR)
- ✅ **Security** with proper escaping and access control
