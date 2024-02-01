import sanitizeHtml, { type IOptions } from "sanitize-html";
const SANITIZE_OPTIONS: IOptions = { disallowedTagsMode: 'recursiveEscape', allowedTags: false, allowedAttributes: false }; // TODO Allow a more fun list than the default, but still prevent XSS and similar

// Base Websocket name for our rooms
const SOCKET_GROUP = 'room_';
const DEFAULT_ROOM = 'General';

// Setup a good generator for our room IDs
// Skip npm and dependencies and just copy the single magic line from https://www.npmjs.com/package/nanoid
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
    // Determine if we have an existing session
    const { searchParams } = new URL(req.url);
    let roomId = null;
    let incomingId = searchParams.get("id") as string;
    if (searchParams && incomingId) {
      if (rooms[incomingId]) {
        roomId = incomingId;
        log("Existing sessionId=" + roomId);
      }
      // If we don't have a match, maybe the user is refreshing a stale or bookmarked URL
      // So let's give them the benefit of the doubt and try to create their session with the desired ID
      else {
        roomId = makeNewSession(incomingId);
      }
    }
    
    // Create a new session
    if (!roomId) {
      roomId = makeNewSession();
    }
    
    // Handle our incoming request depending on the path
    switch (new URL(req.url).pathname) {
      case '/':
        // Read our HTML page file
        let toReturn = await Bun.file('./chat.html').text();
        
        // Log how many rooms we have currently
        log("Session count " + Object.keys(rooms).length);
        
        // Replace our various data points in the page with our current session data
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
        console.error("MESSAGE INTO SERVER", content);
        if (content) {
          content = convertToMessageObj(content);
          
          // If we don't have a roomId to interact with, just bail
          if (!content.roomId) {
            return;
          }
          
          if (content.type) {
            if (content.type === 'join') {
              ws.subscribe(SOCKET_GROUP + content.roomId);
              console.error("JOINED", rooms[content.roomId]);
              
              if (rooms[content.roomId]) {
                try{
                  for (let i = 0; i < rooms[content.roomId].length; i++) {
                    ws.send(JSON.stringify(rooms[content.roomId][i]));
                  }
                }catch (ignored) { }
              }
              
              sendSystemMessage(`<b>${content.sender}</b> joined the room`, content.roomId);
            }
            else if (content.type === 'leave') {
              ws.unsubscribe(SOCKET_GROUP + content.roomId);
              sendSystemMessage(`<b>${content.sender} left the room`, content.roomId);
            }
          }
          else {
            sendMessage(content, content.roomId);
          }
        }
      }catch (ignored) { }
    },
    open(ws) {
      // TODO Janky to get some content
      /*
      setTimeout(() => {
        for (let i = 0; i < 50; i++) {
          sendSystemMessage(`<span style="color: ${generateRandomColor()}">Some junk message</span>`, DEFAULT_ROOM);
        }
      }, 100);
      */
    }
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

function makeNewSession(roomId?: string): string {
  if (!roomId) {
    roomId = generateRoomId();
    log("Make new sessionId=" + roomId);
  }
  else {
    log("Request non-existent, regenerating for sessionId=" + roomId);
  }
  rooms[roomId] = [];
  return roomId;
}

function generateRoomId(tryAttempt: number = 0): string {
  return DEFAULT_ROOM; // TODO For now just all join one big room
  
  // Note uppercasing makes the session way easier to convey to friends, even if we marginally increase our collision odds after a million rooms
  const newId = nanoid(4).toUpperCase();
  
  // For collision matching we're waaaay overdoing it, as just a single regenerate will cover us for 100k+ rooms
  // Which would be amazing if the game and app got that popular, haha
  // But either way, may as well do it right, up to a cap of retries. Should be good for a million rooms or so
  if (rooms[newId]) {
    if (tryAttempt > 100) {
      log("Even after 100 tries of regenerating, we made a duplicate session ID. Current session count is " + Object.keys(rooms).length);
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

function log(message: string, ...extra: string[]): void {
  console.log(new Date().toLocaleString() + " - " + message, extra && extra.length > 0 ? extra : '');
}

log("Bun: Let's chat...or xat...or cat\n");
