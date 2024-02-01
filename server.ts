/* TODO
- Smoother setting of name, and changing after
-- Store locally to avoid re-entering? Especially once it can be changed
- Sent message history - press up arrow to prefill previous message (and auto select all of it in the text box)
- Changing rooms
- Room list or search? Likely just want them all private
- Emojis (Unicode!)
-- Could also leverage something like https://www.npmjs.com/package/emoji-from-text
-- Better emoji font that works cross platform?
- Font color
- Easily toggle who you are, create a local storage list of names, can swap between them
-- Necessary for a few kids sharing a single device
- Better/different styling for messages (bubbles? animations? customizable?)
- Do sanitize HTML list of what is allowed and what isn't
- Built in reaction GIFs?
- Could be fun to try an NPM package for filtering language? https://www.npmjs.com/package/obscenity
- date-fns or similar for relative time on stamps
- User count in a room
- Delete empty rooms automatically, but after a longer time since chat history will go too
- Have a way to @Someone and it will bold/highlight/bounce on their view?
- Easy way to do formatting of messages besides plain HTML?
- Do neat effects, like confetti, snow, message shake, whatever
- Do fun little minigames in chat? Catch Pokemon, do math, dice rolls, votes, change background, etc.
-- Need a way to easily expand/create these, almost like plugins
*/

import sanitizeHtml, { type IOptions } from "sanitize-html";

// TODO Allow a more fun list than the default, but still prevent XSS and plain JS and similar
const SANITIZE_OPTIONS: IOptions = { disallowedTagsMode: 'recursiveEscape', allowedTags: false, allowedAttributes: false, allowVulnerableTags: true };

// Base Websocket name for our rooms
const SOCKET_GROUP = 'room_';
const DEFAULT_ROOM = 'General';

// Setup a good generator for our room IDs
// Just copy the single magic line from https://www.npmjs.com/package/nanoid
// Note instead of defining a custom custom library we just replace - and _ with "Z" instead
const nanoid=(t=21)=>crypto.getRandomValues(new Uint8Array(t)).reduce(((t,e)=>t+=(e&=63)<36?e.toString(36):e<62?(e-26).toString(36).toUpperCase():"Z"),"");

const rooms = <any>{};

interface Message {
  date: Date,
  sender: string,
  message: string,
}

const DEFAULT_HOSTNAME = Bun.env.isProduction ? 'xat.onrender.com' : 'localhost';
const DEFAULT_PORT = 3000;
const server = Bun.serve({
  port: DEFAULT_PORT,
  async fetch(req, server) {
    // Determine if we have an existing room
    const { searchParams } = new URL(req.url);
    let roomId = null;
    let incomingId = searchParams.get("id") as string;
    if (searchParams && incomingId) {
      if (rooms[incomingId]) {
        roomId = incomingId;
        log("Existing roomId=" + roomId);
      }
      // If we don't have a match, maybe the user is refreshing a stale or bookmarked URL
      // So let's give them the benefit of the doubt and try to create their room with the desired ID
      else {
        roomId = createNewRoom(incomingId);
      }
    }
    
    // Create a new room
    if (!roomId) {
      roomId = createNewRoom();
    }
    
    // Handle our incoming request depending on the path
    switch (new URL(req.url).pathname) {
      case '/':
        // Read our HTML page file
        let toReturn = await Bun.file('./chat.html').text();
        
        // Log how many rooms we have currently
        log("Room count " + Object.keys(rooms).length);
        
        // Replace our various data points in the page with our current room data
        toReturn = toReturn.replaceAll('"${HOSTNAME}"', '"' + DEFAULT_HOSTNAME + '"');
        toReturn = toReturn.replaceAll('"${PORT}"', '"' + DEFAULT_PORT + '"');
        toReturn = toReturn.replaceAll('"${ROOM_ID}"', '"' + roomId + '"');
        toReturn = toReturn.replaceAll('${THEME}', generateRandomColor());
        
        return new Response(toReturn, { headers: { 'Content-Length': toReturn.length + '', 'Content-Type': 'text/html;charset=utf-8' }});
      case '/ws':
        if (server.upgrade(req)) {
          return; // Return nothing if successful
        }
        return new Response("Websocket upgrade failed", { status: 500 });
      default:
        return new Response('Not found', { status: 404 });
    }
  },
  websocket: {
    message(ws, content: any) {
      try{
        if (content) {
          content = convertToMessageObj(content);
          
          // If we don't have a roomId to interact with, just bail
          if (!content.roomId) {
            return;
          }
          
          if (content.type) {
            if (content.type === 'join') {
              ws.subscribe(SOCKET_GROUP + content.roomId);
              
              if (rooms[content.roomId]) {
                try{
                  // TODO Only retrieve the last X number of messages for the chat
                  for (let i = 0; i < rooms[content.roomId].length; i++) {
                    ws.send(JSON.stringify(rooms[content.roomId][i]));
                  }
                }catch (error) {
                  log("Failed to send history", error);
                }
              }
              
              sendSystemMessage(`<b>${content.sender}</b> joined the room`, content.roomId);
            }
            else if (content.type === 'leave') {
              ws.unsubscribe(SOCKET_GROUP + content.roomId);
              
              sendSystemMessage(`<b>${content.sender}</b> left the room`, content.roomId);
            }
          }
          else {
            sendMessage(content, content.roomId);
          }
        }
      }catch (ignored) { }
    },
    // Don't do anything with open/close/drain, so leave undeclared
  },
});

function sendSystemMessage(messageText: string, roomId: string, from: string = 'Sysadmin') {
  sendMessage({
    date: new Date(),
    sender: from,
    message: messageText
  }, roomId);
}

function sendMessage(messageObj: Message, roomId: string) {
  // Ignore if we have a junk message
  if (!messageObj ||
      !messageObj.message || messageObj.message.trim().length === 0) {
    return;
  }
  
  // Store our data
  rooms[roomId].push(messageObj);
  
  server.publish(SOCKET_GROUP + roomId, JSON.stringify(messageObj));
}

function convertToMessageObj(stringifiedContent: string): Message | null {
  let toReturn = null;
  try{
    toReturn = JSON.parse(stringifiedContent) as Message;
    
    // Keep us safe from evil, evil tags
    toReturn.message = sanitizeHtml(toReturn.message, SANITIZE_OPTIONS);
    
    // Add any missing properties
    if (!toReturn.date) {
      toReturn.date = new Date();
    }
  }catch (ignored) { }
  
  return toReturn;
}

function createNewRoom(roomId?: string): string {
  if (!roomId) {
    roomId = generateRoomId();
    log("Make new roomId=" + roomId);
  }
  else {
    log("Request non-existent, regenerating for roomId=" + roomId);
  }
  rooms[roomId] = [];
  return roomId;
}

function generateRoomId(tryAttempt: number = 0): string {
  return DEFAULT_ROOM; // TODO For now just all join one big room
  
  // Note uppercasing makes the room way easier to convey to friends, even if we marginally increase our collision odds after a million rooms
  const newId = nanoid(4).toUpperCase();
  
  // For collision matching we're waaaay overdoing it, as just a single regenerate will cover us for 100k+ rooms
  // Which would be amazing if the game and app got that popular, haha
  // But either way, may as well do it right, up to a cap of retries. Should be good for a million rooms or so
  if (rooms[newId]) {
    if (tryAttempt > 100) {
      log("Even after 100 tries of regenerating, we made a duplicate room ID. Current room count is " + Object.keys(rooms).length);
      // In this super duper rare case, just throw in another digit
      return nanoid(5).toUpperCase();
    }
    tryAttempt++;
    return generateRoomId(tryAttempt);
  }
  
  return newId;
}

function generateRandomColor(): string {
  const letters = '0123456789ABCDEF';
  let color = '#';
  
  for (var i = 0; i < 6; i++) {
      color += letters[Math.floor(Math.random() * 16)];
  }
  
  return color;
}

function log(message: string, ...extra: any): void {
  console.log(new Date().toLocaleString() + " - " + message, extra && extra.length > 0 ? extra : '');
}

log("Bun: Let's chat...or xat...or cat\n");
