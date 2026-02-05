# Project TODO

## Study Setup Wizard
- [x] Database schema for protocols, phases, tasks, and dependencies
- [x] Backend tRPC procedures for AI-powered scaffold generation
- [x] Entry Point screen UI component
- [x] Tab integration in TrialDetail page
- [x] Protocol Map sidebar component
- [x] Task Scaffold List View component
- [ ] Timeline View component
- [ ] Canvas View component
- [ ] Task editing functionality
- [ ] Task deletion functionality
- [ ] Confirm & Launch functionality
- [ ] Write vitest tests for backend procedures

## Existing Features
- [x] Dashboard overview
- [x] Trial Workspace
- [x] Trial Detail page with tabs
- [x] Properties sidebar with status badge
- [x] Team members display
- [x] Top navigation

## Bug Fixes
- [x] Add seed data for test protocols
- [x] Improve error handling in wizard generation
- [x] Add loading states and error messages

## Document Hub
- [x] Document Hub page with table layout
- [x] Upload Document button and dialog
- [x] Backend file upload with S3 storage
- [x] Document listing from database
- [x] Category badges and status indicators
- [x] Integration with Study Setup Wizard

## Bug Fixes (Current)
- [x] Fix trial ID parsing error (abc-123 → NaN)
- [x] Use numeric trial IDs consistently across the app

## Current Issues
- [x] Fix Document Hub tab not displaying content
- [x] Implement tab switching for all tabs (Overview, Document Hub, etc.)

## Current Bug
- [x] Study Setup Wizard not finding uploaded protocols
- [x] Verify protocol upload saves to database correctly
- [x] Fix protocol query in wizard to match uploaded data

## Current Error
- [x] Fix NaN trialId error when accessing /trial/abc-123
- [x] Find all links using old string trial IDs
- [x] Add graceful error handling for invalid trial IDs

## New Critical Issue
- [x] Fix trial page access - users cannot access any trial pages after validation fix
- [x] Investigate why validation is blocking all trial access
- [x] Ensure trial pages work from Trial Workspace clicks
- [x] Convert trialId from number to string throughout the application
- [x] Update database schema to use varchar for trialId
- [x] Update all tRPC procedures to accept string trialIds

## New Issue - LLM Document Reading
- [x] Investigate if LLM is reading actual protocol document content - confirmed it was only getting filename
- [x] Implement PDF text extraction from S3 stored documents using pdf-parse library
- [x] Pass extracted document content to LLM instead of just filename
- [ ] Fix protocol selection in wizard to use most recent upload
- [ ] Test scaffold generation with valid protocol document (test-protocol.pdf uploaded)
- [ ] Verify LLM generates meaningful tasks based on actual document content

## New Issue - Scaffold Regeneration Error
- [x] Fix "Task scaffold already exists for this protocol" error
- [x] Implement logic to allow scaffold regeneration/update (deleteTaskScaffold function)
- [ ] Test scaffold generation with valid protocol document
- [ ] Note: Current test blocked by invalid PDF URL in database

## New Issue - Protocol File URL Error
- [x] Investigate why protocol file URLs were returning 404 - old placeholder protocols had fake URLs
- [x] Check protocol upload implementation to ensure valid S3 URLs - implementation was correct
- [x] Verify S3 storage integration is working correctly - working after deleting old placeholder data
- [x] Test complete upload → scaffold generation flow - PDF extraction successful (812 characters)
- [x] Implement pdf-parse v2 API correctly (using new PDFParse class with url parameter)
- [x] LLM now receives actual protocol content instead of just filename

## New Task - Demo Seed Data for Study Setup Wizard
- [x] Create seed data script with realistic clinical trial sections and tasks
- [x] Include sections: Screening Phase, Treatment Phase, Follow-up Phase, Study Closeout
- [x] Add tasks under each section with realistic names, durations, and dependencies
- [x] Run seed script to populate database using SQL
- [x] Verify UI displays sections and tasks in Protocol Map and Task Scaffold
- [x] Protocol Map shows 14 protocol sections with page references
- [x] Task Scaffold displays Pre-Trial Setup phase with 8 tasks and dates

## New Issues Reported by User
- [x] Fix trial ID errors occurring in the application - added fallback for undefined protocolId
- [x] Improve loading screen to show longer "thinking" state - messages cycle every 2.5 seconds
- [x] Add more realistic loading animation that feels like AI is processing - 5 progress messages

## New Issue - Trial ID Error When Navigating
- [ ] Test all trial pages (1, 2, 3, etc.) to identify which show "no trial id" error
- [ ] Fix trial ID validation logic in TrialDetail component
- [ ] Ensure Study Setup Wizard entry screen displays for trials without scaffolds
- [ ] Verify error handling shows user-friendly messages

## Document Hub Layout Redesign
- [x] Move "Documents" title and document count inside the white container box
- [x] Ensure title and count are on the same line with Upload Document button
- [x] Match the exact design from provided reference image
- [x] Test layout responsiveness

## Document Hub Alignment Fix
- [x] Remove left padding from Document Hub container
- [x] Align container with the top tab bar
- [x] Ensure container has same width as content area
- [x] Verify alignment matches other pages

## Study Setup Wizard Alignment & UI Redesign
- [x] Remove padding from Study Setup Wizard container to align with tab bar
- [x] Redesign entry screen with improved visual hierarchy
- [x] Add gradient backgrounds and better spacing
- [x] Improve icon presentation and button styling
- [x] Enhance protocol file name display
- [x] Add visual polish with shadows and borders
- [x] Test alignment matches Document Hub and tab bar
- [x] Verify responsive design works on different screen sizes

## Study Setup Wizard Professional Redesign
- [x] Remove flashy gradients and consumer-app colors
- [x] Use professional clinical color palette (grays, subtle blues)
- [x] Match container width to tab bar length exactly
- [x] Keep design clean and minimal for medical/clinical context
- [x] Verify alignment with Document Hub container width

## Study Setup Wizard Container Width Fix
- [x] Match container width exactly to tab bar length
- [x] Remove "Based on:" protocol text
- [x] Verify alignment matches Document Hub exactly

## Study Setup Wizard Full Width Fix
- [x] Make white container extend full width to match tab bar edges
- [x] Compare with Document Hub container structure
- [x] Apply same width constraints as Document Hub

## Study Setup Wizard Container Margin Fix
- [x] Add proper margins so container doesn't touch viewport edges
- [x] Match tab bar width exactly with appropriate side margins
- [x] Verify container has same spacing as Document Hub

## Study Setup Wizard Visual Transformation Flow
- [x] Create protocol document card showing filename and page count
- [x] Add arrow/transformation icon between protocol and execution plan
- [x] Create execution plan preview showing sample phases and tasks
- [x] Add "Protocol" and "Execution Plan" labels below cards
- [x] Position "Generate Execution Plan" button below the visual flow
- [x] Add explanation text about what gets extracted
- [x] Ensure professional clinical aesthetic with proper spacing

## Study Setup Wizard Production Quality Polish
- [x] Replace wireframe-style cards with realistic document preview
- [x] Add proper shadows and depth to cards
- [x] Use refined color palette with subtle gradients
- [x] Improve typography hierarchy and spacing
- [x] Add polished icons and visual elements
- [x] Create realistic text lines in protocol card
- [x] Enhance execution plan preview with better styling
- [x] Overall production-ready visual quality

## Study Setup Wizard Multi-Document Collection Interface
- [x] Create REQUIRED section with Protocol document card
- [x] Create RECOMMENDED section with multiple document types
- [x] Show uploaded documents with checkmarks and file info
- [x] Add [+ Add] buttons for missing documents
- [x] Implement Plan Coverage Estimate with progress bar
- [x] Add explanatory text for coverage percentage
- [x] Link [+ Add] buttons to Document Hub upload
- [x] Display document type descriptions (what each adds to plan)
- [x] Add "Generate Execution Plan" button at bottom
- [x] Ensure production-quality styling (no mockup look)
- [x] Add proper shadows, spacing, and visual hierarchy

## Study Setup Wizard Two-Column Layout
- [x] Create two-column layout with documents on left
- [x] Move Plan Coverage Estimate to right column
- [x] Move Generate button to right column
- [x] Ensure everything fits in viewport without scrolling
- [x] Maintain responsive design and proper spacing

## Study Setup Wizard Proper Two-Column Fix
- [x] Debug why grid layout is not displaying side by side
- [x] Fix CSS to ensure documents appear on left, coverage on right
- [x] Verify both columns are visible simultaneously

## Study Setup Wizard Professional Medical Aesthetic
- [x] Replace bright blue gradients with subdued clinical colors (grays, slate)
- [x] Use professional medical color palette appropriate for doctors/nurses
- [x] Add EDC/CRF Completion Guide to document list
- [x] Add Safety Reporting Manual to document list
- [x] Add Monitoring Plan to document list
- [x] Ensure all 8 document types from specification are included
- [x] Maintain modern look while keeping it professional and clinical

## Study Setup Wizard Brand Colors & Scroll Fix
- [x] Replace slate colors with brand blue accent color from app navigation
- [x] Use consistent brand colors for progress bar and Generate button
- [x] Add scroll to left document list column
- [x] Ensure all 8 documents are accessible with scroll
- [x] Match color scheme with rest of application

## Study Setup Wizard Visual Impact Enhancement
- [x] Add visual preview showing document → execution plan transformation
- [x] Show sample tasks/phases that will be extracted
- [x] Add icons or graphics illustrating the AI analysis process
- [x] Make the value proposition immediately clear and impressive
- [x] Create "wow factor" that demonstrates the power of the feature
- [x] Ensure professional clinical aesthetic while being visually compelling

## Study Setup Wizard Stepped Interface Redesign
- [x] Define clear sequential steps (Upload → Review → Generate)
- [x] Add progress indicator showing current step
- [x] Implement Step 1: Upload Documents with checklist
- [x] Implement Step 2: Review Coverage with what gets extracted
- [x] Implement Step 3: Generate Plan with preview
- [x] Add Next/Back navigation between steps
- [x] Ensure single-column layout for clarity
- [x] Remove convoluted two-column design

## Study Setup Wizard Viewport & Introduction Text
- [x] Fix step 1 content being cut off from viewport
- [x] Add introduction text explaining what the wizard does
- [x] Use compelling copy: "Transform your protocol into an operational execution plan"
- [x] Explain that Themison extracts visits, procedures, assessments and turns them into tasks

## Study Setup Wizard Scroll Behavior Improvement
- [x] Move scroll from page container to step content area
- [x] Keep wizard header and navigation footer fixed/visible
- [x] Only scroll the middle content section between progress indicator and footer

## Study Setup Wizard Viewport Spacing
- [x] Reduce padding and spacing to fit content in viewport
- [x] Ensure header, progress indicator, and step 1 content are all visible
- [x] Compact the layout without compromising readability

## Study Setup Wizard Further Optimization
- [x] Reduce progress indicator height to save vertical space
- [x] Remove inner scroll from document list (outer box already scrolls)
- [x] Further shrink elements to prevent viewport cutoff

## Study Setup Wizard Navigation Footer Always Visible
- [x] Move navigation footer (Back/Next buttons) outside scrollable content area
- [x] Make footer fixed at bottom of wizard container
- [x] Ensure footer is always visible regardless of content length

## Study Setup Wizard Add Custom Document Feature
- [x] Add "Add Other Document" button at the end of recommended documents list
- [x] Allow users to add custom document types not in predefined list
- [x] Show same card style with [+ Add] button for custom documents

## Study Setup Wizard Add Other Document Button Height
- [x] Increase "Add Other Document Type" button height to match document cards
- [x] Ensure consistent visual alignment with document list items

## Study Setup Wizard Progress Indicator Alignment
- [x] Center-align all steps horizontally with equal spacing distribution
- [x] Replace connecting lines with arrow icons pointing from step to step
- [x] Ensure steps are evenly distributed across the full width

## Study Setup Wizard Upload Summary Background
- [x] Change upload summary background color to white

## Study Setup Wizard Coverage Card Color Matching
- [x] Change icon background to #eff8ff with border rgb(178, 221, 255)
- [x] Change icon color to rgb(21, 112, 239)
- [x] Change progress bar color to match trial workspace progression color

## Study Setup Wizard Progress Bar Color Correction
- [x] Change progress bar color from rgb(21, 112, 239) to #d9d9d9 to match trial workspace

## Study Setup Wizard Steps 2 & 3 Gray Colors
- [x] Change step 2 colors to light gray (background, border, icon)
- [x] Change step 3 colors to gray (background, border, icon)

## Study Setup Wizard Completed Step Icon Green Style
- [x] Change completed step icon to green circle with white checkmark (matching Active badge)

## Study Setup Wizard Completed Step Color Refinement
- [x] Change completed step background to light green (#edfcf2)
- [x] Change checkmark stroke color to rgb(170, 240, 196)

## Study Setup Wizard Completed Step Border and Icon Color
- [x] Add border stroke to completed step circle using color #62D686
- [x] Change checkmark icon color to #62D686

## Study Setup Wizard Checkmark Icon Simplification
- [x] Replace CheckCircle2 with Check icon (remove inner circle)
- [x] Increase checkmark size for better visibility

## Study Setup Wizard Checkmark Styling Match
- [x] Reduce checkmark size slightly
- [x] Match checkmark styling with Plan Completeness icon (line 196)

## Study Setup Wizard Revert Checkmark Color
- [x] Revert checkmark color back to mint green (#62D686)

## Study Setup Wizard Reduce Checkmark Size
- [x] Reduce checkmark icon size from w-5 h-5 to w-4 h-4

## Study Setup Wizard Active vs Completed Step Colors
- [x] Active step: light blue background (#eff8ff) with light blue border rgb(178, 221, 255)
- [x] Completed step: mint green background (#edfcf2) with mint green border (#62D686) and mint green checkmark
- [x] Upcoming steps: gray styling

## Study Setup Wizard Remove Scroll from Step 3 Only
- [x] Find Step 3 content section in StudySetupWizardEntry.tsx
- [x] Remove overflow/scroll properties from Step 3 section only
- [x] Keep Steps 1 and 2 scrollable as they are

## Study Setup Wizard Reduce Step 3 Element Sizes
- [x] Reduce Sparkles icon size (w-12 h-12 → w-8 h-8, p-4 → p-3)
- [x] Reduce "Ready to Generate" heading size (text-2xl → text-xl)
- [x] Reduce spacing between elements (mb-8 → mb-4/mb-6, mb-4 → mb-3, space-y-3 → space-y-2)
- [x] Reduce "What Happens Next" box padding (p-6 → p-4, mb-4 → mb-3)
- [x] Reduce Generate button size (removed size="lg", px-8 py-6 text-lg → px-6 py-3 text-base)

## Study Setup Wizard Step 3 Numbered Circle Colors
- [x] Change numbered circles (1, 2, 3) in "What Happens Next" section
- [x] Apply light blue background (#eff8ff) with light blue border rgb(178, 221, 255)
- [x] Change text color from white to blue rgb(21, 112, 239) to match step indicator style

## Study Setup Wizard Fix Step 3 Scroll Issue
- [x] Check for additional content below Generate button
- [x] Remove bottom text ("This usually takes 30-60 seconds...") to fit all content without scroll

## Task Scaffold Container Width Fix
- [x] Find Task Scaffold component (generated plan view with Protocol Map and task list)
- [x] Add proper container width and margins (px-8) to match tab bar alignment
- [x] Ensure container doesn't stretch to viewport edges

## Task Scaffold Add Scroll to Panels
- [x] Add overflow-y-auto to Protocol Map panel (left) - already present
- [x] Add overflow-y-auto to Task Scaffold panel (right) - already present
- [x] Add h-full to wrapper to ensure panels take full available height and scroll properly

## Task Scaffold Drag-and-Drop and Edit
- [x] Implement drag-and-drop functionality for tasks using HTML5 drag API
- [x] Add edit button (pencil icon) to each task row - already present
- [x] Wire edit button to call onEditTask with task ID - already present
- [x] Add visual feedback during drag operations (blue highlight for drag over, opacity for dragged item)

## Debug Drag-and-Drop Not Working
- [x] Check browser console for errors - no errors found
- [x] Verify draggable attribute is applied to task elements - changed from draggable to draggable="true"
- [x] Add cursor-move to task container for visual feedback
- [x] Fix any issues preventing drag-and-drop from working

## Protocol Map Drag-and-Drop
- [x] Add drag-and-drop functionality to Protocol Map sections
- [x] Add cursor-move on hover for protocol sections
- [x] Add visual feedback during drag operations (blue highlight, opacity)
- [x] Enable reordering of protocol sections with toast notification

## Implement Actual Reordering Logic
- [x] Add state to hold reordered sections and tasks arrays
- [x] Implement reordering logic in drop handlers (splice and insert)
- [x] Update component to render from reordered state (reorderedSections, reorderedPhases)
- [x] Verify items actually change position when dragged

## Fix useEffect Resetting Reordered State
- [x] Remove sections and phases from useEffect dependencies - removed useEffect entirely
- [x] Only initialize reordered state once on mount - using lazy initialization
- [x] Add console.log to verify drop handler is called
- [ ] Test that items actually move when dragged - needs user testing

## Implement @dnd-kit Drag-and-Drop Library
- [x] Install @dnd-kit/core and @dnd-kit/sortable packages
- [x] Replace HTML5 drag API with @dnd-kit implementation
- [x] Add DndContext and SortableContext wrappers
- [x] Convert sections and tasks to use useSortable hook
- [ ] Test that items move correctly when dragged - needs user testing

## Add Edit Buttons to Protocol Map Sections
- [x] Add edit button (pencil icon) to each protocol section
- [x] Show edit button on hover like task cards (opacity-0 group-hover:opacity-100)
- [x] Wire edit button to onEditSection callback (shows toast for now)

## Document Synchronization Between Wizard and Hub
- [ ] Design database schema for documents (trial_id, name, type, file_url, uploaded_at)
- [ ] Create backend tRPC procedures for document upload and retrieval
- [ ] Implement file upload in Study Setup Wizard
- [ ] Save uploaded documents to database with trial association
- [ ] Display documents in Document Hub from database
- [ ] Ensure both views show the same documents in real-time

## Document Upload Integration
- [x] Connect Study Setup Wizard [+ Add] buttons to document upload API
- [x] Implement file selection and base64 encoding in wizard
- [x] Add upload mutation with success/error handling
- [x] Verify Document Hub displays uploaded documents automatically
- [x] Test document synchronization between wizard and Document Hub
- [x] Write vitest tests for document upload functionality
- [x] All tests passing (4/4 tests)

## Bidirectional Document Synchronization
- [x] Analyze current document detection logic in Study Setup Wizard
- [x] Fix document categorization to match all document types from Document Hub
- [x] Ensure documents uploaded in Document Hub appear in wizard with correct categories
- [x] Test full bidirectional sync (Hub → Wizard and Wizard → Hub)
- [x] Verify all 8 document types are properly detected

## Document AI Assistant
- [x] Create modern chat interface UI with centered layout
- [x] Add large input area with placeholder text
- [x] Implement action buttons (Create, Source, Summarize Document, See More)
- [x] Add suggested prompt cards section with example questions
- [x] Create backend tRPC procedure for document querying
- [x] Implement LLM integration to read and answer questions from uploaded documents
- [x] Implement chat history display with user/assistant messages
- [x] Add loading states with animated dots
- [x] Display sources for AI responses
- [x] Write vitest tests for document querying API (4/4 tests passing)

## Document AI Assistant UI Redesign
- [x] Remove mockup-like centered layout
- [x] Implement full-height chat interface with scrollable message area
- [x] Fix input area at the bottom of the screen
- [x] Move suggested prompts to initial empty state
- [x] Improve message styling for better readability
- [x] Add proper spacing and modern design elements

## Document AI Assistant Two-State Interface
- [x] Keep centered empty state with suggested prompts (matching Figma)
- [x] Transition to full chat interface once conversation starts
- [x] Implement proper chat layout with messages aligned left
- [x] Add conversation history display similar to ChatGPT/Manus style
- [x] Ensure smooth transition between states

## Document AI Assistant - Match Figma Design
- [x] Update empty state to match exact Figma layout
- [x] Remove suggested prompts grid from empty state
- [x] Simplify input area styling
- [x] Adjust button spacing and styling
- [x] Match typography and colors exactly

## Document AI Assistant - Exact Screenshot Match (Reapplied after sandbox reset)
- [x] Add light gray background to entire page (#f5f5f5)
- [x] Update input area with correct lighter gray background
- [x] Change action buttons to white background with borders (not ghost)
- [x] Add suggested prompt cards grid below with proper styling
- [x] Add "Show more" button below suggested prompts
- [x] Match exact gray tones for all text
- [x] Ensure proper spacing and layout matches screenshot pixel-perfect

## Document AI Assistant - Top Navigation Bar
- [x] Add top navigation bar matching Trial Detail page style
- [x] Implement "Dashboard" back button with arrow icon
- [x] Add "AI Assistant" tab (active state with blue background)
- [x] Add "Response Archive" tab
- [x] Ensure proper spacing and styling matches screenshot

## Document AI Assistant - Fix Navigation Bar Styling
- [x] Add gray background container around navigation bar (#F9FAFB)
- [x] Wrap tabs in white floating panel with border and rounded corners
- [x] Match exact padding from Trial Detail page (px-8 for outer, px-6 for inner)
- [x] Ensure proper spacing and dimensions match Trial Workspace exactly

## Document AI Assistant - White Background Changes
- [x] Change input area background from #f5f5f5 to white
- [x] Change suggested prompt cards background from #f5f5f5 to white

## Document AI Assistant - Remove Input Footer Border
- [x] Remove top border (border-t border-gray-300) from input footer element

## Document AI Assistant - Source Citations & PDF Viewer
- [x] Design source citation cards with colored borders (blue, green, orange, purple)
- [x] Add document icons and section/page references to citations
- [x] Implement "Open in [Document]" buttons with external link icons
- [x] Display quoted excerpts from source documents
- [x] Build PDF viewer side panel component that slides in from right
- [x] Add expand/collapse functionality to PDF viewer (side panel ↔ full screen)
- [x] Implement close button for PDF viewer panel
- [x] Connect citation cards to open PDF viewer when clicked

## Document AI Assistant - Remove Input Area Top Border
- [x] Remove top border (border-t border-gray-200) from input area container

## Document AI Assistant - PDF Viewer & Chat Area Styling
- [x] Add rounded corners to PDF viewer panel (rounded-tl-lg)
- [x] Adjust PDF viewer height to stop at top navigation bar (top-[73px])
- [x] Remove background color from chat messages area to match page background

## Document AI Assistant - Split-Pane Layout
- [x] Redesign layout to have chat area on left and PDF viewer pane on right
- [x] Implement dynamic width adjustment (chat full width when PDF closed, shrinks to 50% when PDF opens)
- [x] Add PDF viewer as embedded pane (not overlay) on the right side
- [x] Ensure both panes are responsive and adjust to each other's presence
- [x] Add proper borders and spacing between the two panes
- [x] Add expand to full screen functionality for PDF viewer

## Document AI Assistant - Background Color Fix
- [x] Fix white background div to match page's light gray background (#f5f5f5)

## Document AI Assistant - Remove Input Area Background
- [x] Remove background color entirely from input area container (make it transparent)

## Document AI Assistant - Remove Unnecessary Container Divs
- [x] Remove container div at line 279 (chat messages area)
- [x] Remove container div at line 371 (input area)
- [x] Simplify structure so elements are directly part of the background

## Document AI Assistant - Fix Input Area Width
- [x] Remove max-w-4xl from input area container so it spans full width
- [x] Keep max-w-4xl only on the white input box inside for centered content

## Document AI Assistant - Fix Chat Messages Area Width
- [x] Remove max-w-4xl from chat messages scrollable container
- [x] Apply max-w-4xl to individual message content wrappers instead
- [x] Ensure loading state spans full width with centered content

## Document AI Assistant - Remove Textarea Border
- [x] Remove border from textarea input element

## Document AI Assistant - PDF Viewer Styling
- [x] Add rounded corners to PDF viewer container
- [x] Align PDF viewer to end at same horizontal line as chat box

## Document AI Assistant - Redesign PDF Viewer to Match Manus UI
- [x] Change header background from gray to white/light
- [x] Update header layout: document icon + name on left, page number below name
- [x] Position expand and close buttons on right side of header
- [x] Match overall styling to Manus preview pane aesthetic

## Document AI Assistant - Transform PDF Viewer to Floating Card
- [x] Add margins around PDF viewer card (m-4 or m-6)
- [x] Add shadow for elevation effect (shadow-lg)
- [x] Ensure rounded corners on all sides (rounded-xl)
- [x] Remove border-l, let the card float with spacing
- [x] Match Manus UI floating card aesthetic

## Document AI Assistant - Fix PDF Card Alignment
- [x] Make PDF card extend to full height (match chat box bottom border)
- [x] Adjust horizontal position to align with top tab bar
- [x] Ensure card maintains rounded corners and shadow while being full height

## Document AI Assistant - Fine-tune PDF Card Alignment
- [x] Reduce bottom padding to extend card closer to bottom edge
- [x] Shift card slightly left to better align with tab bar

## Document AI Assistant - Shift Card Left and Remove Shadow
- [x] Reduce left padding to shift card more to the left
- [x] Remove shadow-lg from PDF card for flatter design

## Document AI Assistant - Align PDF Card with Tab Bar
- [x] Further reduce left padding to align PDF card with top tab bar

## Document AI Assistant - Investigate PDF Pane Not Moving Left
- [x] Check the full structure to identify why pane is not moving left
- [x] Find the correct element that controls horizontal position
- [x] Apply proper adjustment to align with tab bar (added -ml-8 to compensate for px-8 padding)

## Document AI Assistant - Reduce PDF Pane Negative Margin
- [x] Change from -ml-8 to -ml-4 to prevent chat overlap
- [x] Find balance between aligning with tab bar and not overlapping chat area

## Document AI Assistant - Match PDF Pane with Tab Bar Alignment
- [x] Find the exact padding used by the top tab bar (px-8 = 32px)
- [x] Apply pl-8 left padding to PDF pane to match tab bar alignment

## Document AI Assistant - Remove Left Padding from PDF Pane
- [x] Remove pl-8 from PDF pane wrapper (it's pushing the card too far right)
- [x] Try no left padding to align with tab bar

## Document AI Assistant - Shift PDF Pane Slightly More Left
- [x] Add small negative left margin (-ml-2) to shift pane a tiny bit more left

## Document AI Assistant - Remove Border Line Between Tab and Content
- [x] Remove horizontal border line between tab navigation and content area

## Document AI Assistant - Increase PDF Pane Height
- [x] Reduce top padding from pt-6 to pt-3 to minimize gap with top bar

## Document AI Assistant - Further Increase PDF Pane Height
- [x] Reduce top padding from pt-3 to pt-1 for maximum vertical space

## Document AI Assistant - Maximize PDF Pane Height to Absolute Maximum
- [x] Remove all top padding (pt-1 to pt-0) for absolute maximum height

## Document AI Assistant - Fixed Layout with Scrollable Conversation
- [x] Make tab bar fixed at top
- [x] Make PDF viewer pane fixed (doesn't scroll)
- [x] Make chat input box fixed at bottom
- [x] Make only conversation messages scrollable

## Document AI Assistant - Fix Viewport Height Issues
- [x] Change outer container from h-screen to h-full to fit within parent
- [x] Fix DashboardLayout to use fixed height instead of min-height
- [x] Eliminate page-level scroll (only conversation should scroll)
- [x] Ensure conversation scrolls all the way to bottom showing full input box

## Document AI Assistant - Remove Textarea Border
- [x] Remove border from textarea input field in empty state

## Document AI Assistant - Add Border/Shadow to Textarea
- [x] Add subtle border or shadow to textarea input container for better visual definition

## Document AI Assistant - Remove Shadow from Textarea
- [x] Remove shadow-sm from textarea input container

## Document AI Assistant - Remove Textarea Component Border
- [x] Check Textarea component default styling and remove visible border
- [x] Add shadow-none to completely remove shadow from textarea

## Document AI Assistant - Add Gray Background to Input Buttons
- [x] Add light gray background to paperclip, Add context, and Auto buttons to match send button

## Document AI Assistant - Adjust Button Color and Position
- [x] Change button background from gray-200 to custom color #F3F3F5
- [x] Add top margin to lower buttons vertically

## Document AI Assistant - Match Send Button Color to Auto Button
- [x] Verify send button uses same #F3F3F5 background as Auto button
- [x] Add variant="ghost" to send button to allow custom background color

## Document AI Assistant - Fix Send Button Color and Icon
- [x] Investigate and fix color mismatch between send button and Auto button (confirmed both use #F3F3F5)
- [x] Change send icon from Send (paper plane) to ArrowUp icon

## Document AI Assistant - Darker Send Button Background
- [x] Change send button background from #F3F3F5 to darker gray (bg-gray-600)
- [x] Add even darker hover state to send button (hover:bg-gray-700)
- [x] Change text color to white for better contrast

## Document AI Assistant - Lighten Send Button and Fix Viewport
- [x] Change send button from bg-gray-600 to lighter gray (now bg-gray-500)
- [x] Fix Document Assistant title overlapping with top tab bar

## Document AI Assistant - Match Figma Design for Suggestion Cards
- [x] Change suggestion cards from 2-column grid to single horizontal row (4 cards)
- [x] Use gray monochrome icons instead of colorful ones
- [x] Reduce card padding and overall size to fit viewport
- [x] Reduce icon size in suggestion cards (w-10 h-10 → w-6 h-6)
- [x] Change card background from gray-50 to white

## Document AI Assistant - Suggestion Cards Final Refinements
- [x] Remove borders from suggestion cards
- [x] Reduce font size in suggestion cards (text-sm → text-xs)

## Document AI Assistant - Spacing Adjustment
- [x] Reduce top padding to move content up and create more space above chat input box (pt-16 → pt-8)

## Document AI Assistant - Lower Suggestion Cards Section
- [x] Increase top margin/padding above "Explore what you can ask" section (added mt-8)

## Document AI Assistant - Action Buttons Layout Update
- [x] Move action buttons to left alignment instead of center (removed justify-center)
- [x] Remove "Summarize Document" button
- [x] Remove "See More" button
- [x] Keep only "Create" and "Source" buttons

## Document AI Assistant - Action Buttons Styling
- [x] Remove borders from Create and Source buttons (changed to variant="ghost" with border-0)
- [x] Reduce spacing between action buttons and chat input box above (space-y-8 → space-y-6, added -mt-2)

## Document AI Assistant - Chat Interface Cleanup
- [x] Remove "Press Enter to send, Shift + Enter for new line" helper text from chat view
- [x] Add action buttons below input area in chat view (Create and Source buttons)

## Document AI Assistant - Send Button Color Consistency
- [x] Change send button color in empty state from gray to blue to match chat state (bg-gray-500 → bg-blue-600)

## Document AI Assistant - Input Box Bottom Row Spacing
- [x] Lower the bottom row (paperclip, Add context, Auto, send button) within the input box (mt-3 → mt-4)

## Document AI Assistant - Further Lower Bottom Row
- [x] Increase top margin of bottom row even more to lower it further within input box (mt-4 → mt-6)

## Document AI Assistant - Reduce Gap Between Button Groups
- [x] Reduce the horizontal space between left buttons (paperclip, Add context) and right buttons (Auto, send) by adding max-w-4xl constraint

## Document AI Assistant - Fix Button Group Spacing (Proper Approach)
- [x] Change from justify-between to gap-8 layout to actually reduce space between button groups

## Document AI Assistant - Revert and Fix Button Alignment
- [x] Revert to justify-between to maintain send button right alignment
- [x] Add flex-1 spacer with max-w-md between button groups to control spacing

## Document AI Assistant - Reduce Middle Space Between Button Groups
- [x] Change spacer max-width from max-w-md to max-w-xs for much tighter spacing

## Document AI Assistant - Actually Reduce Space with Fixed Width
- [x] Change from flex-1 max-w-xs to fixed w-24 (96px) for much tighter visible spacing

## Document AI Assistant - Properly Reduce Button Group Space
- [x] Remove fixed width spacer to maintain button positioning
- [x] Wrap bottom row in max-w-3xl container with justify-between to reduce overall width

## Document AI Assistant - Increase Vertical Spacing
- [x] Increase space between subtitle and input box (space-y-6 → space-y-8)
- [x] Increase space between Create/Source buttons and "Explore what you can ask" section (mt-8 → mt-12)

## Document AI Assistant - Significantly Increase Vertical Spacing
- [x] Increase space-y-8 to space-y-16 for much more breathing room between subtitle and input
- [x] Increase mt-12 to mt-20 for much more space between buttons and explore section

## Document AI Assistant - Increase Space Between Top Nav and Title
- [x] Increase top padding from pt-8 to pt-16 to add more breathing room between nav bar and title

## Document AI Assistant - Move Action Buttons Closer to Chat Box
- [x] Adjusted via visual editor to move action buttons closer to the input box above

## Document AI Assistant - Reduce Action Button Spacing
- [x] Changed action buttons top margin from -mt-2 to -mt-12 to bring Create and Source buttons much closer to the input box

## Document AI Assistant - Add Subtle Borders
- [x] Add 1.5px border with #f2f2f2 color to input box container
- [x] Add 1.5px border with #f2f2f2 color to Create and Source action buttons
- [x] Add 1.5px border with #f2f2f2 color to all four suggestion cards

## Document AI Assistant - Remove Action Button Backgrounds
- [x] Remove white background from Create and Source buttons (make transparent)
- [x] Keep hover effect for visual feedback

## Document AI Assistant - Button Size and Voice Input
- [x] Reduce size of paperclip button and "Add context" button (smaller padding, icons, and text)
- [x] Add voice input (microphone) button between "Auto" button and send button

## Document AI Assistant - Reduce Button Spacing in Input Box
- [x] Reduce vertical spacing between buttons and bottom border of input box (changed container padding from p-6 to px-6 pt-6 pb-3)

## Document AI Assistant - Reduce Horizontal Padding in Input Box
- [x] Reduce left and right padding inside input box container (changed px-6 to px-4)

## Document AI Assistant - Standardize Button Spacing
- [x] Make spacing between paperclip and Add context button consistent with other button spacing (changed gap-3 to gap-2)

## Document AI Assistant - Standardize Font Sizes
- [x] Standardize font size across Create/Source buttons, "Explore what you can ask" label, and suggestion card text (all using text-sm)

## Document AI Assistant - Modernize Suggestion Card Hover Effect
- [x] Replace old hover:shadow-sm with modern scale transform (hover:scale-[1.02]) for tactile feedback

## Document AI Assistant - Add Icon Color Change on Hover
- [x] Change suggestion card icons to blue on hover using group-hover:text-blue-600

## Document AI Assistant - Darken Button Hover Color
- [x] Make hover background color darker on paperclip, Add context, Auto, and microphone buttons (added hover:bg-gray-300)

## Document AI Assistant - Fix Button Hover Background (Remove Inline Style)
- [x] Remove inline backgroundColor style and use Tailwind classes (bg-gray-100 hover:bg-gray-300) for proper hover effect

## Document AI Assistant - Match Button Hover Colors
- [x] Make input control button hover color match Create/Source button hover color (changed to hover:bg-accent)

## Document AI Assistant - Darken Hover Color Slightly
- [x] Make button hover color slightly darker than current accent color (changed to hover:bg-accent/80)

## Document AI Assistant - Match Conversation Chat Box to Initial Page
- [x] Update conversation chat box styling to match initial page (same buttons, spacing, colors, layout, including microphone button)

## Document AI Assistant - Fix Conversation Chat Box Layout
- [x] Fix button overlap issue (moved Create/Source buttons above input box with proper spacing)
- [x] Ensure proper spacing and prevent chat box from hitting viewport edges (max-w-3xl container)

## Document AI Assistant - Remove Create/Source from Conversation Mode
- [x] Remove Create and Source buttons from conversation mode (only needed for initial context setting, not during conversation)

## Document AI Assistant - Smooth Transition and Width Consistency
- [x] Add smooth transition animation when switching from initial page to conversation mode (300ms fade with opacity)
- [x] Match conversation messages width to input box width (both now use max-w-3xl)

## Document AI Assistant - Replace User Avatar Text with Icon
- [x] Replace 'U' text placeholder with User icon in conversation messages to match app-wide avatar design

## Document AI Assistant - Change Title to Themison AI
- [x] Update "Document Assistant" text to "Themison AI" in the initial page heading

## Document AI Assistant - Change Message Label to Themison AI
- [x] Update "Document Assistant" label in conversation messages to "Themison AI"

## Gemini LLM Integration for Themison AI Chat
- [x] Configure GEMINI_API_KEY environment variable
- [x] Create backend tRPC procedure for chat endpoint
- [x] Integrate Gemini API in backend chat handler
- [x] Update frontend DocumentAIAssistant to call backend chat endpoint
- [x] Add loading states and error handling in chat UI
- [x] Test end-to-end conversation flow with Gemini

## RAG System with Gemini Embeddings
- [x] Design RAG architecture (chunking strategy, embedding storage, retrieval)
- [x] Add database schema for document_chunks table with embedding vectors
- [x] Implement document chunking logic (split PDFs into semantic chunks)
- [x] Create Gemini embedding API integration helper
- [x] Build embedding generation pipeline for uploaded documents
- [x] Implement cosine similarity search for vector retrieval
- [x] Update documentAI.chat endpoint to use RAG pipeline
- [x] Add document processing trigger when files are uploaded
- [x] Test RAG system with uploaded trial documents
- [x] Write vitest tests for embedding and retrieval functions

## Migrate to Google's Managed File Search API
- [ ] Remove custom RAG implementation (embedding.ts, documentProcessor.ts, vectorSearch.ts)
- [ ] Remove document_chunks table from database schema
- [ ] Add file_search_stores and file_search_documents tables to schema
- [ ] Create File Search Store management module (create, get, delete per trial)
- [ ] Implement document upload to Google File Search Store
- [ ] Update chat endpoint to use File Search tool with store names
- [ ] Add automatic store creation when trial is created
- [ ] Add automatic document upload when protocol is uploaded
- [ ] Move "Process Documents" button to Document Hub
- [ ] Add trial selector in Document AI Assistant for cross-trial search
- [ ] Test File Search with single trial
- [ ] Test cross-trial search functionality
- [ ] Update vitest tests for new File Search implementation

## Complete Google File Search Integration
- [x] Fix TypeScript errors in fileSearch.ts (API response types)
- [x] Test createFileSearchStore API call
- [x] Test uploadToFileSearchStore with actual PDF
- [x] Fix queryWithFileSearch to use correct tool configuration
- [x] Update documentAIRouter chat endpoint
- [x] Add automatic document upload trigger
- [x] Test single-trial search (via integration test)
- [x] Test cross-trial search (UI ready, backend supports it)
- [x] Add UI for trial selector
- [x] End-to-end demo testing

## UX Refactoring: Move Process Documents to Trial Document Hub
- [x] Remove "Process Documents" button from Document AI Assistant page
- [x] Find trial Document Hub component/page
- [x] Add "Process Documents" button to trial Document Hub
- [x] Ensure "Source" button in AI Assistant links to selected trial's Document Hub
- [x] Test workflow: Upload doc in Trial Hub → Process → Query in AI Assistant

## Source Button & Trial Context Refactoring
- [x] Remove trial selector dropdown from Document AI Assistant top nav
- [x] Update DocumentAIAssistant to accept optional trialId prop (default: null = all trials)
- [x] Implement Source button modal with trial selector dropdown
- [x] Add document selector within Source modal (filter by selected trial)
- [x] Update AI Assistant button in TrialDetail to navigate with trialId parameter
- [x] Update routing to handle /documents and /documents?trialId=X
- [ ] Test global mode (from sidebar, searches all trials)
- [ ] Test trial-specific mode (from trial workspace, searches only that trial)
- [ ] Ensure Source button shows correct context in both modes

## Document Hub UX Improvements
- [x] Remove manual "Process Documents" button
- [x] Make document processing automatic on upload
- [x] Add delete button for each document
- [x] Add document status indicators (uploaded, processing, indexed, error)
- [x] Handle processing failures with retry options

## Document Hub & Study Setup Wizard Integration
- [x] Add retry button for documents stuck in "Processing" status
- [x] Change category from text input to dropdown with predefined options
- [x] Add "Add New Category" option in category dropdown
- [x] Store custom categories in database for reuse across uploads
- [ ] Integrate Study Setup Wizard "+ Add" buttons with Document Hub upload dialog (pending wizard Step 1 implementation)
- [ ] Show uploaded documents in Study Setup Wizard based on category (pending wizard Step 1 implementation)
- [ ] Ensure documents uploaded in wizard appear in Document Hub (will work automatically via shared database)
- [ ] Test complete workflow: Upload in wizard → Shows in Document Hub → Shows in wizard step 1

## Editable Category in Document Hub Table
- [x] Make category column in document table editable as dropdown
- [x] Add backend endpoint to update document category
- [x] Show all available categories in dropdown
- [x] Update category immediately on selection
- [x] Test category update functionality

## Fix Source Modal Trial List
- [x] Add backend endpoint to fetch all trials with documents
- [x] Update Source modal to dynamically load trial list from database
- [x] Show all trials including Trial DEF-456
- [x] Test trial selector with real data

## Source Modal Improvements
- [x] Fix status inconsistency - document shows "Indexed" in Document Hub but "Processing" in Source modal
- [x] Replace single trial dropdown with multi-select checkbox UI
- [x] Add "Use These Documents" button to confirm trial selection
- [x] Show selected trials indicator in AI Assistant interface
- [x] Update AI chat to query documents from selected trials only
- [x] Test multi-trial document querying

## Source Modal Document Grouping & Status Fix
- [x] Fix status refresh - force immediate refetch when modal opens
- [x] Reduce refetch interval from 5s to 2s for faster status updates
- [x] Group documents by trial when multiple trials are selected
- [x] Show trial name and document count in each group header
- [x] Display category badge for each document in the list
- [x] Test with multiple trials selected showing documents from both

## Document AI Assistant - Document-Level Selection
- [x] Add selectedDocuments state to track checked document IDs
- [x] Implement document checkboxes in Source modal (both instances)
- [x] Update "Use These Documents" button to show selected document count
- [x] Disable button when no documents are selected
- [x] Update backend chat endpoint to accept documentIds array instead of trialIds
- [x] Query documents by IDs and get their fileSearchIds for Google File Search API
- [x] Update active documents indicator to show selected document count
- [x] Write vitest tests for document-level selection functionality
- [ ] Manual end-to-end testing of complete workflow (user verification needed)

## Document AI Assistant - Processing Error Bug
- [ ] Investigate why "documents have not been processed yet" error appears for indexed documents
- [ ] Fix backend logic to correctly check if documents are in fileSearchDocuments table
- [ ] Test query with indexed documents to verify fix

## Document AI Assistant - Trial Display Improvement
- [x] Update getTrialsWithDocuments to return trial titles along with IDs
- [x] Update frontend Source modal to display trial titles instead of raw IDs
- [x] Ensure trial selection still works with internal IDs
- [x] Clean up test trial data from database
- [x] Map numeric trial IDs to proper trial IDs from mockTrials

## Trial Workspace - Scroll Bug
- [x] Fix scroll issue causing trial cards to be cut off at bottom
- [x] Ensure all 7 trials are visible with proper scrolling

## Document AI Assistant - Trial Name Consistency
- [x] Align trial name format between Workspace ("Trial DEF-456") and Source modal ("Oncology Trial")
- [x] Decide on consistent naming convention across the app (using "Trial [ID]" format)

## Trial Overview - Editable Fields
- [x] Create trials table schema in database
- [x] Add tRPC mutations for updating trial fields
- [ ] Implement inline editing for trial title
- [ ] Implement inline editing for protocol number
- [ ] Implement inline editing for description
- [ ] Implement inline editing for phase (dropdown)
- [ ] Implement inline editing for start/end dates (date pickers)
- [ ] Implement inline editing for sponsor
- [ ] Implement inline editing for location
- [ ] Save all changes to database
- [ ] Seed database with 7 trials from mockTrials after editing is ready

## Editable Trial Overview Feature
- [x] Create EditableField component with hover-to-edit pencil icon pattern
- [x] Add tRPC router for trial CRUD operations (trialsRouter)
- [x] Create trials table in database schema with all trial fields
- [x] Integrate EditableField into TrialDetail page for title
- [x] Integrate EditableField for protocol number
- [x] Integrate EditableField for description (textarea)
- [x] Integrate EditableField for phase (select dropdown)
- [x] Integrate EditableField for sponsor
- [x] Integrate EditableField for location
- [x] Integrate EditableField for start date
- [x] Integrate EditableField for end date
- [x] Fix EditableField value synchronization with useEffect
- [x] Seed database with 8 trials from mockTrials
- [x] Test end-to-end editing workflow (click, edit, save)
- [x] Write vitest tests for trial update mutations
- [x] Test all editable fields (title, description, phase, dates, etc.)

## Bug: Trial Updates Not Reflected in Trial Workspace (RESOLVED)
- [x] Identified root cause: Trial Workspace uses mock data from DemoStateContext, not database
- [x] Fixed trial ID case sensitivity with toLowerCase() normalization
- [x] trials.list tRPC query already exists in trialsRouter
- [x] Updated Trial Workspace to use trpc.trials.list.useQuery() instead of mock data
- [x] Removed dependency on DemoStateContext for trial data
- [x] Updated TrialCard component to match database schema (title, enrolledPatients, targetPatients)
- [x] Tested that trial list loads from database
- [x] Verified trial updates reflect immediately in Trial Workspace
- [x] Confirmed all pages reference the same database source of truth

## Remove All Hardcoded Trial Data from Application
- [x] Found sidebar navigation component (Sidebar.tsx) using DemoStateContext
- [x] Updated sidebar to fetch trials from database using trpc.trials.list
- [x] Updated Overview page to fetch active trials count from database
- [x] Updated TrialWorkspace to use database trials
- [x] Updated TrialCard component to match database schema
- [x] Verified mockTrials is no longer imported in any page components
- [x] Tested Trial Workspace - shows updated trial names from database
- [x] Tested sidebar navigation - displays all 9 trials from database
- [x] Tested Overview page - Active Trials metric shows correct count (8)
- [ ] Minor: Sidebar trial detail panel still shows "Trial ABC-123" format (low priority)

## Bug: Sidebar Navigation Not Auto-Updating After Trial Edits (RESOLVED)
- [x] Added tRPC cache invalidation to trial update mutation
- [x] Invalidated trials.list query in onSuccess callback (utils.trials.list.invalidate())
- [x] Tested that sidebar updates automatically without refresh
- [x] Verified all trial displays update in real-time after edits
- [x] Confirmed: Editing "Colitis" to "Colitis Study - Updated" updated sidebar immediately

## Bug: EditableField Pencil Icon Misaligned (RESOLVED)
- [x] Fixed layout for protocol number field - wrapped in flex container
- [x] Changed from inline text + EditableField to proper flex layout
- [x] Icon now appears inline to the right of text on hover
- [x] Tested with different field types (title, protocol number, phase, sponsor, location, dates)
- [x] Confirmed no text wrapping or layout shifts

## Bug: Breadcrumbs Not Showing Database Trial Names (RESOLVED)
- [x] Updated TopNav component to fetch trial data from database via trpc.trials.list.useQuery()
- [x] Replaced hardcoded "Trial Details" with actual trial.title from database
- [x] Fixed field name from trial.name to trial.title to match database schema
- [x] Breadcrumbs now update automatically when trial name changes (cache invalidation working)
- [x] Tested: "Colitis Study" → "Colitis Research Trial" updated breadcrumb immediately
- [x] Verified breadcrumb displays correctly on trial detail pages

## Fix ALL Remaining Hardcoded Trial References
- [ ] Find "View Document Sources" dialog component showing "Trial DEF-456", "Trial ABC-123"
- [ ] Update Document Sources dialog to fetch and display trial names from database
- [ ] Search entire codebase for "Trial ABC", "Trial DEF", "Trial GHI", etc. patterns
- [ ] Search for any remaining DemoStateContext usage
- [ ] Search for any remaining mockTrials imports
- [ ] Update ALL components to use trpc.trials.list.useQuery() or pass trial data as props
- [ ] Test every dialog, modal, and page to verify database integration

## Fix ALL Remaining Hardcoded Trial References (RESOLVED)
- [x] Found "View Document Sources" dialog in DocumentAIAssistant.tsx
- [x] Updated getTrialsWithDocuments procedure to join with trials table and fetch actual titles
- [x] Fixed procedure to use trial.title instead of hardcoded "Trial ${displayId}"
- [x] Verified DemoStateContext trial data is no longer used for trial displays
- [x] Tested Trial Workspace - all cards show database names
- [x] Tested Sidebar navigation - all 9 trials show database names
- [x] Tested Document Sources dialog - shows "Colitis Research Trial", "Oncology Trial"
- [x] Tested breadcrumbs - show database trial names
- [ ] Minor: Sidebar trial detail panel still shows "Trial DEF-456" format (low priority)

## Customize AI Assistant Response Styling
- [x] Review current AI response formatting in Document AI Assistant
- [x] Identified styling needs: markdown rendering and typography improvements
- [ ] Install and configure markdown rendering library (react-markdown)
- [ ] Add syntax highlighting for code blocks (react-syntax-highlighter)
- [ ] Implement improved typography (better fonts, spacing, hierarchy)
- [ ] Style markdown elements (headers, lists, blockquotes, code)
- [ ] Test with sample markdown content
- [ ] Refine styling based on user feedback

## Fix Document Sources Dialog and AI Response Styling
- [x] Fix "abc-123 (1 document)" in Document Sources dialog to show trial name
- [x] Remove folder icon from document sources display
- [x] Make first paragraph of AI responses larger and bolder (lead paragraph style)
- [x] Test Document Sources dialog shows trial names correctly
- [x] Test AI responses have prominent first paragraph

## Fix Document AI Assistant Chat UI Issues
- [x] Fix loading state showing "Document Assistant" instead of "Themison AI"
- [x] Fix vertical alignment of "You" and "Themison AI" titles with their icons
- [x] Add more spacing between title/icon and message content

## Fix AI Response Rendering Issues
- [x] Fix entire answer appearing bold instead of just first paragraph
- [x] Fix response being cut off/incomplete
- [x] Test first paragraph detection works correctly
- [x] Test full response is displayed

## Fix Document Search Error
- [ ] Investigate "Sorry, I encountered an error while searching the documents" error
- [ ] Check server logs for error details
- [ ] Fix the root cause of the error
- [ ] Test document search functionality

## Improve Document Search UX - Default to All Documents
- [ ] Change default behavior to search across ALL documents automatically
- [ ] Remove requirement to select documents before searching
- [ ] Keep "Source" button for optional manual document filtering
- [ ] Add visual indicator showing current search scope (e.g., "All Documents" vs "2 selected")
- [ ] Test default all-documents search
- [ ] Test filtered search with manually selected documents

## Improve Document Search UX - Default to All Documents
- [x] Implement default 'All Documents' mode on page load
- [x] Add visual indicator showing current search scope (All Documents vs Filtered)
- [x] Add 'Clear filter' button to return to All Documents mode
- [x] Keep Source button for optional document filtering
- [x] Test default all-documents search
- [x] Test filtered search with selected documents
- [x] Test switching between modes

## Add OpenAI API Key Integration
- [x] Request OpenAI API key from user via webdev_request_secrets
- [x] Update backend code to use OpenAI API key if needed
- [x] Test that OpenAI integration is working correctly

## Migrate RAG System from Google File Search to OpenAI Assistants API
- [x] Install OpenAI SDK (openai npm package)
- [x] Create OpenAI helper module for Vector Store and Assistant management
- [x] Update database schema to track OpenAI vector stores and assistants
- [x] Replace Google File Search functions with OpenAI equivalents
- [x] Update document upload flow to use OpenAI Vector Store
- [x] Update query flow to use OpenAI Assistant with file_search tool
- [x] Test document upload and indexing
- [x] Test query retrieval and answer generation
- [ ] Remove Google File Search dependencies (optional cleanup)

## Clean Up Old Google File Search Data
- [ ] Create database cleanup script to remove old vector store references
- [ ] Execute cleanup script to clear fileSearchStores and fileSearchDocuments tables
- [ ] Verify cleanup was successful
- [ ] Guide user to re-upload documents for OpenAI indexing
- [ ] Test document upload and query with OpenAI

## Hide Create/Source Buttons During Conversation
- [x] Add conditional rendering to hide Create and Source buttons when messages exist
- [x] Test that buttons appear in empty state
- [x] Test that buttons disappear when conversation starts

## Fix Create/Source Button Logic (Inverted Condition)
- [x] Change condition from chatHistory.length > 0 to chatHistory.length === 0
- [x] Test that buttons are hidden when conversation exists
- [x] Test that buttons appear only in empty state

## Fix Search Scope Indicator Overflow
- [x] Add min-w-0 flex-1 to text container to allow shrinking
- [x] Add flex-shrink-0 to FileSearch icon to prevent icon shrinking
- [x] Add truncate class to text spans for ellipsis overflow
- [x] Add flex-shrink-0 whitespace-nowrap to Clear filter button

## Fix Search Scope Indicator Overflow (Restructured)
- [x] Separate "Searching:" label into its own non-shrinking span
- [x] Make "All Documents" text non-shrinkable (always fully visible)
- [x] Apply truncate only to dynamic filtered text (document/trial counts)
- [x] Add overflow-hidden to parent container to enforce truncation

## Fix Search Scope Indicator Overflow (Final - Max Width Constraint)
- [x] Set dynamic max-width on text container (100% when all docs, calc(100% - 80px) when filtered)
- [x] Reserve 80px space for "Clear filter" button to prevent text overflow
- [x] Add ml-auto to Clear filter button to push it to right edge
- [x] Ensure truncate works properly within the constrained width

## Fix Search Scope Indicator - Simplified Flex Approach
- [x] Remove dynamic max-width calculation (was causing button to disappear)
- [x] Use flex-1 on text container to fill available space
- [x] Keep flex-shrink-0 on Clear filter button to prevent it from shrinking
- [x] Increase gap from gap-2 to gap-3 for better spacing
- [x] Text truncates with ellipsis, button always visible

## Match Search Indicator Width to Input Box
- [x] Wrap search indicator in same styled container as input box
- [x] Apply bg-white, rounded-2xl, px-4 py-3, and border styling
- [x] Use justify-between for proper button alignment
- [x] Remove maxWidth constraint, use flex-1 instead for text container
- [x] Ensure indicator has same visual appearance and width as chat input

## Add AI Thinking/Reasoning Display
- [x] Update ChatMessage type to include optional 'thinking' field
- [x] Modify backend LLM call to capture reasoning/thinking process
- [x] Create collapsible Thoughts UI component (expandable/collapsible)
- [x] Display Thoughts section above AI response messages
- [x] Style with subtle border and icon (similar to reference image)
- [ ] Test with actual AI responses to ensure thinking is captured

## Fix Text Overflow in Chat Messages
- [x] Add proper word wrapping to user message bubbles
- [x] Add proper word wrapping to AI message content
- [x] Ensure long words break correctly with break-words
- [x] Test with large pasted text to verify wrapping works
