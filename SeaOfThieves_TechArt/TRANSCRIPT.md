# The Technical Art of Sea of Thieves - Transcript

**Video URL:** https://www.youtube.com/watch?v=y9BOz2dFZzs  
**Talk by:** Rare Ltd. (Valentin Simonov & Team / Unreal Engine GDC Showcase)  
**Duration:** 41m 11s (2,471s)  

---

## Table of Contents

- [Introduction & Overview (00:00 - 02:44)](#introduction--overview)
- [Art Direction (02:44 - 03:31)](#art-direction)
- [Engine & Tooling (03:31 - 05:22)](#engine--tooling)
- [Ocean: Exploration & Visual Targets (05:22 - 08:26)](#ocean-exploration--visual-targets)
- [Ocean: Performance & Simulation (08:26 - 14:51)](#ocean-performance--simulation)
- [Clouds: Concept (14:51 - 15:44)](#clouds-concept)
- [Clouds: Iteration (15:44 - 17:12)](#clouds-iteration)
- [Clouds: Rendering (17:12 - 25:12)](#clouds-rendering)
- [Clouds: Limitations & Optimizations (25:12 - 31:07)](#clouds-limitations--optimizations)
- [Ropes Systems (31:07 - 33:38)](#ropes-systems)
- [Ropes: Performance (33:38 - 34:26)](#ropes-performance)
- [Tentacles (Kraken) (34:26 - 38:11)](#tentacles-kraken)
- [Lightning & Wrap Up (38:11 - 41:11)](#lightning--wrap-up)

---

## Introduction & Overview (00:00 - 02:44)

**[00:00]** cool so this is the technical art of sea of Thieves uh we have quite a bit of stuff to cover so I'm going to keep a very brisk pace photography and recording is encouraged

**[00:13]** uh there's going to be bits of code and math which hopefully you guys can take away and use and we will try to make the slides available probably from the rare website

**[00:25]** in the near future a little note about our Tech art team so it's split roughly into two halves we have some people working with configuration tools creating scripts

**[00:35]** doing binding and rigging supporting the artists and the other half we work more with the engine with shaders doing this Dev and bits of gameplay code so this is this talk is very much focused on the

**[00:50]** work of that second half of the tech art team and obviously we can do it without a wonderful and amazing rendering engineers so this is the launch trailer for sea of

**[01:01]** Thieves uh we released in March sea of Thieves is a shared World adventure game you grew up with friends or strangers and you go out onto the Open Seas and you get up to all kinds of pirate

**[01:16]** hijinks it is very much an open sandbox kind of world where the players can pretty much do whatever they want as opposed to being any kind of more guided experience

**[01:27]** so that brings all kinds of its own challenges because everything you do has to be robust and stand up to the players abusing it in all kinds of bizarre ways we have a single expensive asset then

**[01:42]** you have to be prepared for the players spending 48 hours straight Gathering 200 versions of that asset and putting them down all into the same spot and then complaining about the performance

**[01:56]** [Music] so that's a quick preview of quite a few of the features we'll be talking about today so the theme of this talk is stylization

**[02:13]** and simulation specifically uh tigraph we see a lot of game talks about bringing photorealism and physically based rendering into real-time pipelines and we thought it'd

**[02:27]** be interesting to talk about how we combined that with a more stylized our Direction uh but hopefully while we're talking about this we'll also give you guys

**[02:36]** stuff that is useful that you can use in your games and to achieve your own art Direction whether that's photorealistic or stylized

## Art Direction (02:44 - 03:31)

**[02:45]** uh so there was a talk at gec this year by Ryan Stevenson who's our art director uh the art of sea of Thieves and he talked about the three art pillars and this work that we've done very much

**[02:57]** covers uh the challenges posed by the first two uh the first one is that it's an illustrative approach which most notably affected our work by the fact that we were kind of very averse to high

**[03:12]** frequency detail which goes counter to a lot of the stylistic trends in games and the second one is a world in motion which is that we wanted the entire world to be dynamic to not have any static

**[03:25]** frames have things moving and updating and reacting to the player's actions

## Engine & Tooling (03:31 - 05:22)

**[03:31]** uh just some background we're using Unreal Engine 4 we started on 4.6 and we stopped taking our decent 410 it's deferred renderer and a reference platform was the Xbox One at 900 P30 so

**[03:42]** that's what all of the timing captures that you'll see in a stock are from however we also scaled up to Native 4K and Xbox One X and we try to hit as many PC specs as we can we use mostly stock

**[03:54]** ue4 Graphics we do some optimizations and slightly different techniques for shadows and for ssao we don't use screen space Reflections we just use planar water Reflections for the ocean we have

**[04:06]** a fully Dynamic time of day and we use like propagation volumes for real-time GI uh interestingly during this production bottlenecks have primarily been on CPU

**[04:16]** and memory not so much on the GPU so you might notice throughout the stock that some of things we've done have specifically been about offloading work from the CPU onto the GPU and as a

**[04:26]** result we sometimes maybe haven't optimized the GPU bits quite as much as we might have otherwise because that was not where the bottleneck was uh so this talk is split up into three

**[04:39]** parts so there's quite a bit to get through first off we'll be talking about water rendering then a little bit about the work we've done in clouds and finally some fun things with vertices

**[04:50]** uh so let's begin with the ocean which is the possibly the most notable feature of the game um Mark Lucas our lead rendering engineer and the rest of the team

**[04:59]** implemented uh fft water simulation based on tessendorf's uh simulating ocean water paper from 2001. it's a fairly straightforward implementation and on the tech art side we were mostly

**[05:10]** focused on using the Sim data to then develop the water surf Shader uh it's not physically based we haven't been able to find any particularly good models for doing water surface shading

## Ocean: Exploration & Visual Targets (05:22 - 08:26)

**[05:23]** so our main problem was to how to integrate this with highly stylized R Direction because the highly realistic water that we get out of the tesundor fft method is very noisy lots of high

**[05:36]** frequency detail doesn't really sit necessarily that well with our art style we experimented with a few things we eventually noticed that even in like more style icgi movies the water tends

**[05:48]** to be more realistic so we've ended up airing more on that side of the equation rather than making it too stylized uh we mostly stylize the foam and we also boosted the strength of the subsurface

**[06:01]** scattering Beyond uh will be considered realistic to help it fit in with the style we also tried a few other things like we did try to simplify the shape of the water simplify the specular

**[06:12]** highlights take away some of that high frequency detail but essentially we found that if we did that the water looked less good so we decided to keep it a little bit more detailed but you

**[06:25]** know keep that uh wow factor of just seeing pretty water so for the subsurface scattering we use the choppiness vertex offsets from the fft skin Sim to generate a mask for

**[06:36]** where the sides of the waves are and then we just use a DOT product of the light and view Vector for the SSS contribution and this is what that looks like along with the specular

**[06:46]** and then the book of the work is in the film generation which we use using the methods uh described in tasendorf's paper um you take the Jacobian determinant of

**[06:57]** the transform and generates firm where it goes negative we inject pixels into a render Target which tiles across the tiny water surface so this is roughly an indicator of where the choppiness

**[07:09]** offsets cause the wave Peaks to overlap on themselves and then we bias the Jacobin to get more foam so if the water sort of slice graph looks like a bit in blue the yellow is the Jacobian of the

**[07:22]** transform and we just biased that down we get more bits of foam being generated that looks something like this when we rendered them into the render Target which looks kind of nice but it's

**[07:32]** definitely far too noisy for our art style so what we do is we actually progressively blur the render targets so what you get out of that is that where

**[07:41]** you have the peaks of the Waves you still get these kind of sharp crests but then that foam gradually dissipates over the progressive blur frame by frame uh we blend this with artist authored foam

**[07:54]** textures we have a high frequency foam texture at the crest of the wave and then when we blend to a lower frequency texture as it Blends out and then we blend this with the watercolor and this

**[08:05]** is most of the water rendering we also use the same Watercress where we generate foam to generate some particles off the top of the waves but that's basically it for

**[08:19]** stormy water we just increase the amplitude of the waves and we bias the Jacobian even further to get more foam that works pretty well

## Ocean: Performance & Simulation (08:26 - 14:51)

**[08:26]** this is by far the most expensive bit of rendering in the game as you can see here so most of these terms are fairly constant for updating the ffts and doing the various resolves

**[08:41]** calculating normals the most expensive bit at the end is where we draw the water surface that one's obviously mostly pixel Shader bounce so it's dependent on how much water you're

**[08:52]** actually seeing on the screen at one time in this case we're only seeing water so we're paying almost eight milliseconds for it but in that case we're not actually rendering anything

**[09:02]** else so the total frame time in this case was about 20 milliseconds so we can afford that next up we wanted to do an effect for the deck of the ship where we have

**[09:13]** shallow water sploshing around on the deck generated by the white bow waves we decided to run a surface water Sim uh we're assuming the deck is leaky which simplifies the

**[09:25]** fact that the water is never going to get too deep and we can assume that you know water's leaking away so we don't need to preserve the volume particularly accurately

**[09:35]** so we use a height field to present the deck of the ship and this captures like the crevices between the planks it's a fairly small render Target 512 by one line two and we run a two pass

**[09:48]** shallow water simulation based on this paper fast hydraulic erosion simulation visualization GPU essentially it just flows water from points where it's higher to neighboring

**[10:00]** cells where the water level is lower on the first bass we calculate the outflow for every cell and because the ship is rocking about on the waves we use the normal of the surface to

**[10:12]** actually bias the height Outlook generation at this step and this allows the water to roll back and forth across the deck of the ship when it rocks on the second pass We Gather inflow from

**[10:24]** neighboring cells and subtract outflow and the current amount of water gets rendered Into the Blue channel of the render Target and we also have persistent wetness if the cell contains

**[10:34]** water and that's written to the green Channel and then we subtract a little bit of water from the green and from the blue which means that the water drains away over time and the wetness dries up

**[10:46]** so this is what just the render Target visualization looks like of the blue channel so you can see it sploshes around and it gathers in some of these crevices between planks

**[10:57]** using this we generate a normal map and we modify the deck material properties so we interpolate between the deck normal the water normal and then we change the specular and the gloss and

**[11:09]** the diffuse and this is what the final result looks like in the game this is then connected up to sensors on the front of the ship which trigger the bowel waves when you crash into a wave

**[11:23]** on the ocean and this splashes water onto the deck and you see it get wet and roll about this is very cheap this is about 0.2 milliseconds in total to update for a

**[11:37]** single ship and we tend to try and make sure we only do it for a ship at a time uh next up we wanted to have waterfalls and flowing water and we decided that we want to have a special system for

**[11:49]** generating intersection foam and also occlusion for waterfalls so we did this by again rendering uh the geometry to a separate render Target and what we do is we render the mesh for

**[12:03]** example a waterfall mesh with an unwrapped UV to that second render Target where the UV is the screen position of the mesh but for every pixel that we're rendering we still have its

**[12:14]** screen position in the projection from the camera in the actual scene so we know what the distance of that pixel is from the camera and we can also sample the scene depth that was rendered

**[12:26]** earlier in the G buffer pass and we actually know what is the distance of like the nearest solid thing like behind or in front of that pixel so this kind of looks like this so if we

**[12:40]** have a flat water plane which is in red in the scene and we have that white square overlapping with it if we're rendering this green pixel in the render Target we can sample the scene depth and

**[12:50]** we can see what the depth is of that object at that pixel and we compare it with the distance of the geometry from the camera and if those one those distances are close enough together we

**[13:03]** can render a value into the render Target which gives us an intersection map so what we get from that is something like this where we are then able to

**[13:16]** interact and blur that intersection map over time and you can get sort of flowing foam being generated by objects that are set with the water surface so what's happening here is we're

**[13:29]** additively blending the results with the previous frame we had vect it and we blur the texture same as we're doing with the foam so this is the sort of flow map we use

**[13:41]** you'll notice that only pixels that are marked on screen are updated so that's also a mass that we generate during that render Target pass and with the flow map is also scrolled

**[13:53]** and in the game we also use this for things like waterfalls in this case you'll see that the supports for the bridge actually occlude the water from the

**[14:02]** waterfall and this isn't done through geometry or a texture this is done with the real-time depth occlusion and then we also adapt this into a similar effect for the ocean surface

**[14:16]** that's how generator foam mask in this case we just have a traveling window for render Target around the player and again this is progressively blurred so you get this nice foam trail behind

**[14:29]** objects to move through the water but this is also how we generate the foam around static geometry like islands and then we blend this with the watercolor and with foam texture

**[14:39]** again this is super cheap this is less than 0.1 milliseconds for something like that waterfall example so next up let's look at clouds

## Clouds: Concept (14:51 - 15:44)

**[14:51]** so this is the sort of concept art we saw back when we were first starting on sea of Thieves and in particular they wanted to do crazy things like storms that actually

**[15:03]** sit in the world and Pull A Reign of sheet around with them and they also decided they want to mark up points of interest with things like skull clouds and other differently shaped clouds so

**[15:16]** this was an interesting challenge for us to solve we had a whole bunch of kind of structural requirements and that had to maintain stabilization and the clouds have to be 3D and they're Dynamic and

**[15:28]** have been controlled by artists and they have to have a physical three-dimensional position in the world and they have to be cheap of course and there were also all the aesthetic

**[15:38]** requirements the clear readable shapes sometimes geometric designs sometimes sharp lines but sometimes fluffy edges

## Clouds: Iteration (15:44 - 17:12)

**[15:45]** uh we tried a few things at first before we even started working in unreal we experimented with Billboards and with Sky domes uh we tried out a few different approaches to Ray marching the

**[15:57]** clouds we found this was far too expensive both on the GPU and in terms of storing volumetric textures and memory uh especially if you're having things like

**[16:08]** skull clouds that just becomes quite hard to manage with Ray marched approaches so we decided to go a different way and we were initially inspired by the passive hate a short

**[16:20]** film which if you guys have seen what they do is they have a geometrical core to the clouds and they scatter Billboards on that core with uh painted on brush Strokes which give them a very

**[16:32]** stylized painterly appearance and we really like that and we tried that out in an early version of the game this is the odd diorama back in unreal 4.6 uh this look nice in some cases but for

**[16:47]** a lot of them it didn't actually fulfill the style requirements that well and more importantly we found that although that approach works well for offline rendering in our case for real-time

**[16:57]** rendering uh you have first of all the issue of sorting of those Billboards and secondly even though there's a core geometry to the cloud on the edges what you end up having a lot of overdraw so

**[17:09]** it's actually still rather expensive

## Clouds: Rendering (17:12 - 25:12)

**[17:12]** so how do you make solid geometry look fluffy and more importantly how do you do cheaply we bent back and forth in this and eventually came up with this approach so

**[17:23]** we started out by rendering the clouds into a separate off-screen render Target and in this case it's a very simple forward render and in fact we calculate all the lighting per vertex it's

**[17:34]** extremely quick and cheap then we down sample this to quarter res and we run a single pass compute Shader gaussian blur and a neat trick we do here is we actually change the standard deviation

**[17:47]** of the gaussian blur based on the depth of the scene this is very rough implementation because we want to make this Shader really very cheap you might be able to

**[18:00]** get better quality results by actually using maybe some kind of depth of field technique we actually decide realized that we want to create a texture Which packs both the

**[18:12]** depth and the alpha which left us with only two channels for color so the red channel is the sunlight and the green channels the Skylight which is why those clouds had such a weird color

**[18:22]** interestingly enough if any of you were in The Potpourri talk Yesterday by Pixar it's interesting to notice that they export their clouds in a similar sort of way when they're rendering billboards

**[18:35]** uh so what we also do is we run a box blur on the depth which has the nice effect that we actually end up with a flat depth kind of on the mid-level clouds it doesn't

**[18:48]** um it doesn't blend off at the edges and you'll see why that's useful in a second so then what we do is we draw a quad which is pinned to the frustum of the camera and we hold it at about 500

**[19:02]** meters in front of the camera which is what we reckon is the closest you'll ever get to a cloud in the game um essentially uh the pixel Shader then which gets rendered onto the quad is the

**[19:13]** most expensive part of this process so we want to make sure that we have as few pixels being rendered as possible and what we do the reason we do this is that

**[19:24]** if you have any objects then that come up in front of the Quad they will occlude the pixels behind it they won't get rendered and we also do an initial sample of the depth map and we discard

**[19:34]** any pixels that cannot possibly contain clouds which is anything which is not black on this picture so then one of the things that we can do is we can actually use that blur depth

**[19:44]** to calculate an approximate blurred World space position and that's kind of what that looks like in this case so you'll see it's not especially temporally stable there's some Jitter

**[19:55]** around the edges so we definitely wouldn't want to use this for lighting but we can use this essentially for compositing we can do things like we can blend fog in and out based on the

**[20:07]** heights of the clouds and we can change their Distortion which we're going to apply in a second so then we look up into a cube map of distortion which has a low frequency

**[20:19]** noise in the red and green channels and this high frequency noise in the blue and Alpha channels and using the depth we can blend between these noises and as you'll notice the clouds in the distance

**[20:28]** they actually fall off towards the horizon to give the impression of a cloud Dome and you can see that the noise Fades off to Black this is because we Kill The Noise below a certain height

**[20:40]** where where you have features like skull clouds being rendered slightly below the cloud line we want to not noise them out too much so as to preserve the feature details

**[20:52]** and then if we apply this noise to the output we get this kind of result we also threshold the alpha again with distance so that clouds and distance appear sharper and look like they're

**[21:05]** further away whereas clouds overhead remain soft and fuzzy and then we do this with the red and green channels which we multiply out by the sunlight and the Skylight and we get

**[21:17]** this kind of effect and finally we just need to apply some fogging which we can control based on the wall space position and that's essentially how we render clouds halfway through production we

**[21:31]** decided to add a spyglass that brought up the question of what happens if you zoom in and out and it turns out holds up quite well what we don't do is we don't change the

**[21:40]** diameter of the gaussian blur based on the fov because that would be expensive but the Distortion actually remains constant and you get this nice feature preserving property on it so it doesn't

**[21:52]** look too bad this is not especially expensive so for this scene this is kind of what the breakdown looks like and again the most expensive

**[22:02]** bit is the pixel Shader at the end and generally speaking you're only paying for the pixels you see so it's quite affordable in total that scenes about 1.3 milliseconds to render

**[22:13]** uh we experimented a little bit with the lighting model essentially what we'll do is we bake out some data into every vertex about where the bulk of the mass of the rest of the mesh is a side effect

**[22:28]** of this is they have intersecting meshes they don't know that they're intersecting measures so you can get scenes unlike you know if you were doing rematching in which case you just step

**[22:39]** through the whole thing but the advantage of it is that it's very cheap and in this case we actually ended up using this point light test to do the

**[22:52]** lightning inside of storm clouds so the lightning is just a point light that's whizzing around and lighting up the surface of the cloud when it gets close enough

**[23:02]** this lighting rendering is not particularly physically based so there's definitely room for improvement there but it's proven to be a fairly robust approach

**[23:14]** and then finally we have a couple of cylinders of range sheets underneath the storm which we blend in with a rain post process when you go into them and one neat trick we're actually able to do

**[23:26]** here is if you look out of the sun we artificially punch a hole through the rain sheets at every time in the direction of the sun which gives it a quite a nice screenshotable moment

**[23:41]** so uh the keto equipment is from this uh which I think might be useful to you guys is this is basically the main specific method of upscaling and I we reckon that this could be use on a few

**[23:53]** different types of source rendering we're using for poly meshes but it might also be as applicable to particles or even as a way of upscaling low-res Ray marching it could be useful for the

**[24:06]** effects you could potentially blend it with other translucent particles and geometry by having them read the cloud depth and fade themselves out accordingly

**[24:15]** and what we'd also like to do is add some temporal blending which might also allow us to support the translucency uh interestingly there's a similar technique in Shader X5 by benassia

**[24:27]** minasi it's a slightly different implementation but very similar concept so I recommend checking that out as well interestingly if you decide to use this for kind of near ground objects this is

**[24:39]** what that might look like so because we have the blur depth uh you can actually get very nice intersections with the world it's in this case not physically correct because we don't step through to

**[24:52]** kind of figure out the thickness of the object everything uh Blends fairly uniformly but you still get pretty nice effects and when we were first setting up we were thinking like oh you could

**[25:02]** have you know giant Cliffs that intersect through the clouds and that would look very cool we didn't actually end up using that in the game because we don't have any Cliffs high enough but

**[25:09]** it's an interesting application

## Clouds: Limitations & Optimizations (25:12 - 31:07)

**[25:12]** uh the limitations is that at the moment because of the cube map Distortion we're using that works very well for the specific use case where you generally have clouds moving relative to the

**[25:24]** player but you never have the player moving that quickly relative to the clouds if you end up moving very quickly then you have the Distortion kind of Rippling through the clouds based on

**[25:34]** player movement which you don't want if the clouds move very fast it looks like the cloud Rippling so that's that looks correct but not the other way around but you can generate the Distortion in other

**[25:44]** ways it doesn't have to be a cube map and you can also get artifacts because of that depth blur fall off if you have things are very different depths stacked

**[25:54]** together especially if you have like a solid geometry in between you can get slight artifacting we've never found it to be particularly bad and it's mostly due to

**[26:02]** the blur hack and you can also get jittering in those cases which could be uh cleared up with some temporal dithering uh finally uh let's do some vertex

**[26:16]** Dynamics so first of all we wanted to figure out how to do ropes because in our game uh players directly interact with ship rigging they can adjust the height of

**[26:30]** the sails the rotation of the sales we also have the wonderful idea that masts need to fall over when they're hit by cannonballs essentially we realized we had to do a

**[26:42]** lot of ropes and we wanted them to be very Dynamic ropes because again like that art pillar it's a world of motion we didn't want to just have you know straight lines going everywhere

**[26:55]** simulating Road physics is expensive especially when you have hundreds of row segments on the screen at the same time so I had the crazy idea like you know can

**[27:04]** we solve ropes as an equation uh especially like what if we take the start point and the end point and the Rope length can we like get a curve out of that because ropes are parabolas

**[27:16]** right uh so uh after some research turns out that ropes are hyperbolism but there's actually really needs and simple equation for solving precisely that

**[27:27]** problem where you have start point and endpoint and you have the length of the rope and you want to figure out what the curve is but that's actually transcendental

**[27:38]** equations so there's now analytic solution to it well hlsl happens to have hyperbolic intrinsics I always wondered why they're pretty slow but we're dealing

**[27:51]** with mesh deformation so we only really need to compute this per vertex and that horrible equation we really actually need so once per rope segment because that gives us the parameter for

**[28:04]** the hyperbola curve and then we can just plug that into the hyperbolic equation so let's try a numerical approximation so we're trying to solve a function which essentially looks like this where

**[28:18]** you're plugging in the X which is the zero to one length traveled around along the Rope segment horizontally and you're plugging in the height between the two points and the length which needs to be

**[28:30]** normalized to that to that rope segment to the horizontal distance between the two points and this is essentially the Shader code to solve that so in our case we use 20

**[28:44]** iterations and that gives it u a which is the parameter you want to plug into your Cosh function and at the end you get the Y which is

**[28:55]** the vertical displacement down from the horizontal representation of the Rope and you can then plug this into vertex deformation in this case we're deforming a ribbon and we're not doing anything

**[29:09]** crazy in terms of shading but you get this kind of behavior where essentially you can move the points around but the length of the Rope remains constant so you get this very nice physical Behavior

**[29:21]** if you move into far apart we obviously just clamp the length um because of the approximation what happens if you move them too close you get that

**[29:31]** but that's fine because if we look close you realize that it's actually a very predictable case it happens when you have a specific ratio between the length of the rope and the horizontal distance

**[29:44]** between the two points so we're going to tackle that in a second first up uh we're obviously not happy with ribbons we want to have proper geometric ropes we want to have normals and we want to

**[29:56]** have you know volume to them so to do that we're going to need to grab the hyperbolic derivative and that gives you the gradient and from that you can derive the normal and therefore you can

**[30:08]** push out the other vertices in whatever correct shape you need next up we also want UVS realized at the very end of this because otherwise if you just you know have the naive

**[30:23]** parameterization of the UVS you get texture stretching we want the correct distance traveled along the curve which will give us correct tiling unfortunately the arc

**[30:33]** length is not a pretty function and we have to evaluate this twice once for x0 and once for each x uh every vertex along the point but that gives us length traveled and

**[30:49]** now that we have the normals we have the correct tangent space for the surface of the curve so you get actually these nice perfectly correctly normal mapped ropes which you can

**[31:01]** deform and move around and they they preserve the length of the Rope

## Ropes Systems (31:07 - 33:38)

**[31:07]** so next up now that we have this we can chain these rope segments together and can create rope systems essentially in this case what we want is for the length of the Rope to be the product of the

**[31:20]** distance between the two points and when the position between the points changes we can just propagate the length offset through the system so we can get essentially systems of pulleys where the

**[31:33]** Rope runs through the pulleys and everything kind of looks correct and to solve that horrible case of the Precision breaking down we just cheat and we tighten the Rope to a

**[31:47]** straight line when we realize it's approaching a problem case which is fine because we just propagate the offset and it looks like the Rope is spooling up uh so here's an example of a roping

**[32:01]** police system if you guys can see when the block at the bottom moves which is the anchor the Rope ends up reeling through all of the pulleys and everything's being updated kind of

**[32:12]** correctly so you always have one end of the rib system which is kind of an infinite reel which reels the rope in and out as necessary and the other is the anchor which moves everything around

**[32:26]** so as you as you do this uh we've also added like a little bit of wind sway you could do this probably quite correctly by rotating the entire Arc around the axis between the two points we're not

**[32:41]** doing that we're just adding a bit of a sine wave as you can see here that what that rope at the top is doing is it just it's turning into a straight line as soon as uh

**[32:51]** as soon as we know that there's going to be an issue there for in the distance we switch to much simpler rendering the ropes because we don't need to calculate proper normals

**[33:03]** and we use the fenwire AA from experiences from Avalanche studio in 2012 so we change the thickness of the ropes and we change the translucency so you get this naturally anti-alias

**[33:18]** looking representation and this is what the final result looks like when you're on the deck of the ship and you move changing the rotation of the sails you get all the ropes kind of

**[33:31]** correctly rolling through the pulleys and adjusting themselves based on the shape and the angle of the sails

## Ropes: Performance (33:38 - 34:26)

**[33:38]** uh so on the Xbox One if we do a naive implementation kind of according to the Shader code I showed earlier you get about 0.035 milliseconds per a rope of 65 Hertz we mostly use Square cross

**[33:53]** sections for the ropes that's tends to be good enough although we do actually tessellate them when we get very close which is scary but it works

**[34:03]** in practice we've actually moved a lot of that precalculation of the transcendental doing the iterations onto the CPU and then we render a bunch of the Rope segments in parallel as instant

**[34:16]** static meshes and it's a bit hard to actually get a good cost estimate of what it is per segment of row but it is very very cheap

## Tentacles (Kraken) (34:26 - 38:11)

**[34:27]** and next up tentacles so this was work we did quite late um kind of pretty much just in the rush to release and we had a design that required cracking tentacles to wrap

**[34:41]** around ships the animation graph is slow to valuate on the CPU and we wanted lots of wrap variants and we wanted to make sure the tentacles then clipped through ship geometry so we

**[34:52]** decided to take approach from the Finding Dory 2 talk on finding Hank and how the pixel guy simulated uh squishy octopus and had a animator driven uh defamation coupled

**[35:08]** with simulation so we decided to try a similar thing and have Houdini drive an fem Sim and then we export this to per vertex texture animation you could potentially

**[35:18]** also do some kind of scanning solution kind of like the Uncharted guys do where you convert vertex animation to an arbitrary skinned mesh that would be uh more efficient in terms of memory

**[35:32]** usage but it wasn't really useful for us because of the CPU constraints the texture Shader reads texture animation for normals and positions so you thanks to the fem Sim we get this

**[35:43]** kind of displacement of the tentacle out from the ship hole and there's 19 rap animations so this saved our animators a lot of time because they essentially could reuse the same animation for the

**[35:54]** different tentacle placements which were design driven and we've just run the simulation we get the correct penetration uh for every animation we actually save out several different

**[36:04]** stapes states and we have essentially keyframes which you can use to transition between the uh between these states which are sort of identical so there's a wrap again wrap loop as the

**[36:16]** tentacle sits around the ship there's also a Wrangle when it's pushing the ship about and it's kind of moving around a little bit more so we want to be able to blend between all of these

**[36:24]** things we export two textures we have a 16-bit position date and a bit normal data and then we also actually pack some tangent information to the alpha Channel

**[36:35]** we also have a lot of version with fewer vertices and fewer frames for when you're looking at the tentacles wrapping around the ship from a distance and because we're interpolating The

**[36:45]** Frame data we actually export only 117 frames of the original 900 frame animation and this is the first several Pentacle wraps we ship the game with now we actually have another seven because

**[36:57]** we've added a new ship type and that was a very simple process of re-exporting re-baking more wraps for a new ship uh and one new trick we found along the

**[37:08]** way is we can actually blend bake blend shaped data into tangent space uh often if you want to have state changes for a mesh and you want to do cheaply what you can do is you can bake a blend shape

**[37:19]** into the UVS off the mesh and in the Shader switch the local position between the baked position data and the UVS and you can get a simple blend shape transition but you can't normally do

**[37:31]** this if an object is skinned and sometimes you don't want to play castle blend shapes in the animation pipeline we certainly didn't so what we found is you can actually

**[37:40]** save out the displacement for every vertex and tangent coordinate frame and that gets updated by the skinning for free so for example this is actually a skinned version of the tentacle and this

**[37:54]** is an exaggerated version of the suckers puckering in and out and we also use the vertex colors to displace the blend shape so they don't all do it in sync and we also ended up using the same

**[38:08]** effect to animate the gills on the Megalodon

## Lightning & Wrap Up (38:11 - 41:11)

**[38:11]** and finally we realized we want to do something fun with lightning I'll go through this one pretty quickly essentially we have an L system we generate in Houdini I mean generally

**[38:22]** several versions of the L system so that per vertex would bake out data on how far you have traveled along the length of the L system and we also back out data which tells us which branch is the

**[38:34]** main branch and the result of this if we slow the lightning effect down is it looks quite close to the slow motion videos of actual lightning strikes in that we

**[38:46]** basically thresholds through the traversal values on the geometry and then once we get to the end we make the main branch very thick and bright and that gives the effect of that lightning

**[39:00]** bolt as it finds a grounding point [Music] actually completely unplanned the video guys had been doing about several hundred takes and they just happen to

**[39:21]** have one where the lightning accidentally struck the ship at exactly the right time so in conclusion uh basically our approach has been that stylized art

**[39:32]** essentially has a physical basis um stylization for us is taking physical phenomenon and adding a stylistic interpretation uh we have tried to maintain a physical grounding for all

**[39:44]** the workflow improvements that gives us and the simulation allows us to iterate and to create have more versions of all this excellent stuff and an excellent demonstration for that is the vomit that

**[39:58]** we developed for when your pirate gets very very drunk and so we ran several simulations in Houdini and what we did then is we baked out these simulations to Athos which we can

**[40:10]** threshold through and you get this wonderful result where you have physically accurate vomit splatter I'm going to skip through the future work but essentially we just want to do

**[40:26]** more simulationy stuff and also give more artists control for this because the in the way we've done this on sea of Thieves is this has mostly been stuff

**[40:38]** developed just within the tech art team as kind of feature key moments we want to give artists more control some acknowledgments and also we're hiring in our absolutely gorgeous Countryside

**[40:51]** studio in the middle of rural green England it is absolutely beautiful that it's looking a bit scorched at the moment and

**[41:00]** feel free to contact us if you have any questions and there's some references at the end thanks guys

